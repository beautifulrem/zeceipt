// The first routes that move money (slice D2): submit a batch, read its derived status.
//
// Submit is synchronous and idempotent per batch: the nonce `batch/<id>` is the key, so a retry replays
// the recorded txid (`Idempotent-Replayed: true`, as Stripe marks replays) and a resubmit after an
// uncertain attempt reconciles against the chain before it could ever pay again (slice A). Every
// execution problem states `payment`: `not_sent` (certain) or `unknown` (money may have moved; check
// the status route). A lost answer is never reported as a failure (Konclave #280, design 3.3.1.4.5.1).
// Problem details are fixed text: the wallet's own messages stay in the submission record, where the
// status route reports them (`detail.error`).
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
import { serverContext, type ServerContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";

export const SubmitBody = z.strictObject({ confirmTotalZat: z.string().regex(/^[0-9]{1,17}$/) });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const statusPath = (id: string) => `/api/batches/${id}/status`;

function backendOrConflict(ctx: ServerContext): ZkoolBackend {
  if (ctx.backend) return ctx.backend;
  throw new HttpProblem(409, "custody_external", "this console runs in external-signer custody and never pays or tracks payments itself", { payment: "not_sent" });
}

async function batchOr404(ctx: ServerContext, id: string) {
  const rec = UUID_V7.test(id) ? await getBatch(ctx.db, ctx.config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  return rec;
}

/** `POST /api/batches/:id/submit` with `{"confirmTotalZat": "<the batch total>"}`: 202 once broadcast. */
export async function submitResponse(req: Request, id: string): Promise<Response> {
  const ctx = serverContext();
  const backend = backendOrConflict(ctx);
  const rec = await batchOr404(ctx, id);
  const parsed = SubmitBody.safeParse(await readJson(req));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new HttpProblem(400, "body_invalid", 'send {"confirmTotalZat": "<the batch total in zatoshi>"}', { issues, payment: "not_sent" });
  }
  const total = rec.items.reduce((s, i) => s + i.zat, 0n);
  if (BigInt(parsed.data.confirmTotalZat) !== total) {
    throw new HttpProblem(422, "confirmation_mismatch", "confirmTotalZat does not equal this batch's total; nothing was sent", { payment: "not_sent" });
  }
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

const CHECK = "check GET /api/batches/{id}/status before acting";

/** Execution failures → problems with a `payment` verdict (design 3.3.1.4.5.3–.4); the mapper `guarded` uses. */
export function executionProblem(e: unknown): Response | undefined {
  if (e instanceof PreflightFailedError) {
    return problem(422, "preflight_failed", "the batch failed preflight; nothing was sent", {
      payment: "not_sent",
      problems: e.problems.map((p) => ({ code: p.code, ...(p.itemIndex === undefined ? {} : { index: p.itemIndex }), detail: p.detail })),
    });
  }
  if (e instanceof PaymentRejectedError) {
    return problem(409, "payment_rejected", "the wallet refused before building a transaction (for example, not enough funds); nothing was sent; submitting again is safe", { payment: "not_sent" });
  }
  if (e instanceof UnknownOutcomeError) {
    return problem(502, "outcome_unknown", `the wallet's answer was lost or unusable, so the payment may have been sent; ${CHECK}. Submitting again is safe: it looks for the payment on chain and never pays twice`, { payment: "unknown" });
  }
  if (e instanceof SubmissionInFlightError) {
    return problem(409, "submission_in_flight", `another submit of this batch is still running; ${CHECK}`, { payment: "unknown" }, { "Retry-After": "5" });
  }
  if (e instanceof NonceConflictError) {
    return problem(409, "nonce_conflict", "this batch's nonce was used for different content; nothing was sent; do not retry, investigate", { payment: "not_sent" });
  }
  if (e instanceof StoreBusyError) {
    return problem(503, "store_busy", "the database is busy; nothing was sent; retry shortly", { payment: "not_sent" }, { "Retry-After": "1" });
  }
  if (e instanceof ZkoolTransportError || e instanceof ZkoolGraphqlError) {
    return problem(502, "wallet_unavailable", `the wallet did not answer usefully; ${CHECK}. Submitting again is safe`, { payment: "unknown" });
  }
  return undefined;
}
