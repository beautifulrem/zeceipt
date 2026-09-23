// The first routes that move money (slice D2): submit a batch, read its derived status.
//
// Submit is synchronous and idempotent per batch: the nonce `batch/<id>` is the key, so a retry replays
// the recorded txid (`Idempotent-Replayed: true`, as Stripe marks replays) and a resubmit after an
// uncertain attempt reconciles against the chain before it could ever pay again (slice A).
//
// Every submit problem states `thisRequest` (review D2 round 1): what THIS request did, which the code can
// prove, not what happened to the batch, which only the status route can say (a batch may have been paid
// by an earlier submit). `sent_nothing`: this request broadcast nothing, either because it failed before
// reaching the backend or because the backend raised one of the errors it only raises before calling
// Zkool's `pay` (every failure after `pay` becomes `UnknownOutcomeError`, zkool-backend.ts). `may_have_sent`:
// the outcome of this request's payment is not known (`outcome_unknown`, or anything unrecognised after
// the backend was reached: a 500 is indeterminate, as Stripe says). Every problem links the status route
// (`batchStatus`; RFC 9457's own `status` member is the HTTP status code).
// A lost answer is never reported as a failure (Konclave #280). Problem details are fixed text: the
// wallet's own messages stay in the submission record, where the status route reports them.
//
// The handler never reads `request.signal`: a client that disconnects mid-pay does not abort the pay.

import { z } from "zod";
import { batchNonce, getBatch, toExecutionBatch } from "../data/batches.ts";
import { getBatchStatus } from "../data/status.ts";
import { StoreBusyError } from "../execution/idempotency.ts";
import {
  NonceConflictError,
  PaymentRejectedError,
  PreflightFailedError,
  SubmissionInFlightError,
  UnknownOutcomeError,
} from "../execution/types.ts";
import type { ZkoolBackend } from "../execution/zkool-backend.ts";
import { ZkoolGraphqlError, ZkoolTransportError } from "../execution/zkool-client.ts";
import { ContextNotReadyError, serverContext, type ServerContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";

export const SubmitBody = z.strictObject({ confirmTotalZat: z.string().regex(/^[0-9]{1,17}$/) });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const statusPath = (id: string) => `/api/batches/${id}/status`;

function backendOrConflict(ctx: ServerContext): ZkoolBackend {
  if (ctx.backend) return ctx.backend;
  throw new HttpProblem(409, "custody_external", "this console runs in external-signer custody and never pays or tracks payments itself");
}

async function batchOr404(ctx: ServerContext, id: string) {
  const rec = UUID_V7.test(id) ? await getBatch(ctx.db, ctx.config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  return rec;
}

/** `POST /api/batches/:id/submit` with `{"confirmTotalZat": "<the batch total>"}`: 202 once broadcast. */
export async function submitResponse(req: Request, id: string): Promise<Response> {
  let reachedBackend = false;
  let inFlightMs: number | undefined;
  const status = UUID_V7.test(id) ? statusPath(id) : undefined;
  try {
    const ctx = serverContext();
    const backend = backendOrConflict(ctx);
    inFlightMs = backend.inFlightMs;
    const rec = await batchOr404(ctx, id);
    const parsed = SubmitBody.safeParse(await readJson(req));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      throw new HttpProblem(400, "body_invalid", 'send {"confirmTotalZat": "<the batch total in zatoshi>"}; this request sent nothing', { issues });
    }
    const total = rec.items.reduce((s, i) => s + i.zat, 0n);
    if (BigInt(parsed.data.confirmTotalZat) !== total) {
      throw new HttpProblem(422, "confirmation_mismatch", "confirmTotalZat does not equal this batch's total; this request sent nothing");
    }
    reachedBackend = true;
    const sent = await backend.submit(toExecutionBatch(rec), batchNonce(rec));
    return new Response(JSON.stringify({ batchId: rec.id, txid: sent.txid, replayed: sent.replayed, via: sent.via, status: statusPath(rec.id) }), {
      status: 202,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Location: statusPath(rec.id),
        ...(sent.replayed ? { "Idempotent-Replayed": "true" } : {}),
      },
    });
  } catch (e) {
    throw submitProblem(e, reachedBackend, status, inFlightMs);
  }
}

/** `GET /api/batches/:id/status`: the derived status (slice B3), never stored. */
export async function statusResponse(id: string): Promise<Response> {
  const ctx = serverContext();
  const backend = backendOrConflict(ctx);
  await batchOr404(ctx, id);
  const status = await getBatchStatus(ctx.db, backend, ctx.config.orgId, id, { requiredConfirmations: ctx.config.confirmations });
  if (!status) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  return new Response(JSON.stringify({ batchId: id, ...status }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/**
 * The problem for a failed submit, with `thisRequest` and the status link (design 3.3.1.4.5.3–.4).
 * Before the backend is reached nothing can have been sent. After it, only the backend's pre-pay errors
 * are `sent_nothing`; `UnknownOutcomeError` and anything unrecognised are `may_have_sent`.
 */
export function submitProblem(e: unknown, reachedBackend: boolean, status: string | undefined, inFlightMs?: number): HttpProblem {
  const nothing = { thisRequest: "sent_nothing", ...(status ? { batchStatus: status } : {}) };
  const maybe = { thisRequest: "may_have_sent", ...(status ? { batchStatus: status } : {}) };
  const check = "the batch's own state is at the status route";
  if (e instanceof HttpProblem) return e.withExtra(reachedBackend ? maybe : nothing);
  if (e instanceof ContextNotReadyError) return new HttpProblem(503, "not_ready", "the console has not finished starting; this request sent nothing", nothing);
  if (e instanceof UnknownOutcomeError) {
    return new HttpProblem(502, "outcome_unknown", `the wallet's answer was lost or unusable, so this request may have paid; ${check}. Submitting again is safe: it looks for the payment on chain and never pays twice`, maybe);
  }
  if (e instanceof PreflightFailedError) {
    return new HttpProblem(422, "preflight_failed", `the batch failed preflight; this request sent nothing; ${check}`, {
      ...nothing,
      problems: e.problems.map((p) => ({ code: p.code, ...(p.itemIndex === undefined ? {} : { index: p.itemIndex }), detail: p.detail })),
    });
  }
  if (e instanceof PaymentRejectedError) {
    return new HttpProblem(409, "payment_rejected", `the wallet refused before building a transaction (for example, not enough funds); this request sent nothing and submitting again is safe; ${check}`, nothing);
  }
  if (e instanceof SubmissionInFlightError) {
    return new HttpProblem(409, "submission_in_flight", `another submit of this batch is running (an attempt counts as running for up to ${Math.round((inFlightMs ?? 0) / 60_000)} minutes); this request sent nothing; ${check}`, nothing, { "Retry-After": "5" });
  }
  if (e instanceof NonceConflictError) {
    return new HttpProblem(409, "nonce_conflict", `this batch's nonce is recorded for different content; this request sent nothing; do not retry, investigate; ${check}`, nothing);
  }
  if (e instanceof StoreBusyError) {
    return new HttpProblem(503, "store_busy", `the database is busy; this request sent nothing; retry shortly; ${check}`, nothing, { "Retry-After": "1" });
  }
  if (e instanceof ZkoolTransportError || e instanceof ZkoolGraphqlError) {
    return new HttpProblem(502, "wallet_unavailable", `the wallet did not answer usefully before any payment; this request sent nothing and submitting again is safe; ${check}`, nothing);
  }
  // Unrecognised: indeterminate once the backend was reached (a 500 is indeterminate, as Stripe says).
  return new HttpProblem(500, "internal", reachedBackend ? `the console could not complete this request and it may have paid; ${check}` : "the console could not complete this request; this request sent nothing", reachedBackend ? maybe : nothing);
}

/** Status reads never pay: a busy store is a plain 503, an unreachable wallet a 502; anything else is the fixed 500 (`guarded`). */
export function statusProblem(e: unknown): Response | undefined {
  if (e instanceof StoreBusyError) return problem(503, "store_busy", "the database is busy; retry shortly", {}, { "Retry-After": "1" });
  if (e instanceof ZkoolTransportError || e instanceof ZkoolGraphqlError) {
    return problem(502, "wallet_unavailable", "the wallet did not answer, so the chain status is unknown; nothing is claimed; retry later");
  }
  return undefined;
}
