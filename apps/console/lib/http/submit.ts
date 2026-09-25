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
import { batchNonce, getBatch, toExecutionBatch, type BatchRecord } from "../data/batches.ts";
import { validApproval } from "../data/approvals.ts";
import { currentLock, recordQuote, type StoredQuote } from "../data/rates.ts";
import { movedText, pctFromBps, rateDrift } from "../rates/drift.ts";
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
import { approvalCheck, ContextNotReadyError, serverContext, type ServerContext } from "../server/context.ts";
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
export function submitResponse(req: Request, id: string): Promise<Response> {
  return submitBatch(id, () => readJson(req));
}

/**
 * The whole submit, shared by the API route and the page's Server Action (slice E2), so both answer the
 * same: `readBody` supplies the parsed body (JSON for the route, the form's fields for the page) and is
 * read inside the `thisRequest` bookkeeping. Throws only `HttpProblem`s (mapped by `guarded`/`answer`).
 */
export async function submitBatch(id: string, readBody: () => Promise<unknown>): Promise<Response> {
  let reachedBackend = false;
  let refusedBeforePay = false;
  let inFlightMs: number | undefined;
  const status = UUID_V7.test(id) ? statusPath(id) : undefined;
  try {
    const ctx = serverContext();
    const backend = backendOrConflict(ctx);
    inFlightMs = backend.inFlightMs;
    const rec = await batchOr404(ctx, id);
    // A voided batch can never be paid (slice H5c): refused before the backend, so nothing was sent.
    if (rec.voidedAt !== undefined) throw new HttpProblem(409, "batch_voided", `the batch was voided on ${rec.voidedAt.slice(0, 10)}: it can never be paid; this request sent nothing`);
    const parsed = SubmitBody.safeParse(await readBody());
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      throw new HttpProblem(400, "body_invalid", 'send {"confirmTotalZat": "<the batch total in zatoshi>"}; this request sent nothing', { issues });
    }
    const total = rec.items.reduce((s, i) => s + i.zat, 0n);
    if (BigInt(parsed.data.confirmTotalZat) !== total) {
      throw new HttpProblem(422, "confirmation_mismatch", "confirmTotalZat does not equal this batch's total; this request sent nothing");
    }
    // REQ-CON-21 (slice G2b1, review round 1): the rate guard runs before EVERY attempt that will pay (a fresh
    // batch, a retry after a refusal, a re-send of an attempt proven unminable) and never on a path that may
    // already have paid (a replay, or a reconciliation that finds the payment). The backend decides which is
    // which (`beforePay`). A guard refusal happens before any pay, so it is `sent_nothing` even though the
    // backend was reached.
    reachedBackend = true;
    const beforePay = async () => {
      try {
        // Slice I3: approval first (no network call), then the rate guard's fresh quote. The lock is read once, so both
        // judge the same lock (review I3 round 1: a re-lock between two reads could split them).
        const lock = await currentLock(ctx.db, ctx.config.orgId, rec.id);
        await approvalGuard(ctx, rec, lock);
        await rateGuard(ctx, rec.id, lock);
      } catch (e) {
        refusedBeforePay = true;
        throw e;
      }
    };
    const sent = await backend.submit(toExecutionBatch(rec), batchNonce(rec), { beforePay });
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
    throw submitProblem(e, reachedBackend && !refusedBeforePay, status, inFlightMs);
  }
}

/**
 * The approval guard (slice I3; design I3.1.5): every attempt that will pay needs a valid approval, for this backend,
 * of exactly the lines this attempt pays (`rec`, the record handed to the backend) at the batch's current lock, read
 * in `beforePay` so a re-lock since the request began is seen. Runs before any pay, so a refusal is `sent_nothing`.
 */
async function approvalGuard(ctx: ServerContext, rec: BatchRecord, lock: StoredQuote | undefined): Promise<void> {
  if (!lock) return; // the rate guard refuses with `rate_not_locked`: locking comes before approving
  const check = approvalCheck(ctx);
  if (!(await validApproval(ctx.db, check.keyring, rec, lock, check.backend))) {
    throw new HttpProblem(409, "not_approved", "approve the batch as it is now, at its current rate lock, before paying (POST /api/batches/{id}/approve); a re-lock or any change needs a new approval; this request sent nothing");
  }
}

/**
 * The lock-vs-execution guard (REQ-CON-21; slices G2a, G2b1). A current lock is required. A fresh quote is taken
 * and recorded as the execution quote before the attempt pays (a fresh batch: before its submission exists;
 * a retry: while its record is `failed_retryable`, which can be re-locked). A move beyond `rateMaxDriftBps`
 * refuses. It runs before any pay, so every refusal is `sent_nothing`.
 */
async function rateGuard(ctx: ServerContext, batchId: string, lock: StoredQuote | undefined): Promise<void> {
  if (!lock) throw new HttpProblem(409, "rate_not_locked", "lock the batch's ZEC/USD rate before paying (POST /api/batches/{id}/rate-lock); this request sent nothing");
  const quote = await ctx.quote();
  const exec = await recordQuote(ctx.db, { orgId: ctx.config.orgId, batchId, purpose: "execution", quote });
  const drift = rateDrift(lock.rate, exec.rate, ctx.config.rateMaxDriftBps);
  if (drift.moved) {
    throw new HttpProblem(409, "rate_moved", `ZEC/USD moved ${movedText(drift.bps, ctx.config.rateMaxDriftBps)} since the lock; at most ${pctFromBps(ctx.config.rateMaxDriftBps)} is allowed; re-lock the rate, approve the batch again, then pay; this request sent nothing`, {
      rate: { lock: lock.rate, lockedAt: lock.fetchedAt, execution: exec.rate, quotedAt: exec.fetchedAt, driftBps: drift.bps, maxDriftBps: ctx.config.rateMaxDriftBps, direction: drift.direction },
    });
  }
}

/** `GET /api/batches/:id/status`: the derived status (slice B3), never stored. */
export async function statusResponse(id: string): Promise<Response> {
  const ctx = serverContext();
  const backend = backendOrConflict(ctx);
  await batchOr404(ctx, id);
  const status = await getBatchStatus(ctx.db, backend, ctx.config.orgId, id, { requiredConfirmations: ctx.config.confirmations, approval: approvalCheck(ctx) });
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
  // A void that landed between the check above and this attempt (slice H5c, review H5c round 1). The 0019 triggers
  // refuse it only on writes that come before any pay: creating the attempt, claiming it back to `submitting`, or
  // recording the guard's execution quote. The write after a pay sets `broadcast`, which they ignore, and a void is
  // itself refused while an attempt may have sent. So this refusal means nothing was sent.
  if (voidedRefusal(e)) return new HttpProblem(409, "batch_voided", `the batch was voided while this request ran: it can never be paid; this request sent nothing; ${check}`, nothing);
  // The execution quote's source failed (slice G2b1; by code: the library loads twice under Next, E1).
  if ((e as { code?: unknown } | null)?.code === "rate_unavailable") {
    const reason = (e as { reason?: unknown }).reason;
    return new HttpProblem(502, "rate_unavailable", `the ZEC/USD source did not give a usable quote, so the rate could not be checked; this request sent nothing; ${check}`, { ...nothing, reason: typeof reason === "string" ? reason : "unknown" });
  }
  // Two mined transactions of the account already pay this batch (slice S5): nothing was paid; a person decides.
  if ((e as { code?: unknown } | null)?.code === "already_paid_ambiguous") {
    return new HttpProblem(409, "already_paid_ambiguous", `${(e as Error).message}; ${check}`, nothing);
  }
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

/** The 0019 triggers' refusal of a write for a voided batch (raw, or mapped to `batch_voided`), anywhere in the cause chain. */
export function voidedRefusal(e: unknown): boolean {
  for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) {
    const { message, code } = c as { message?: unknown; code?: unknown };
    // The raw trigger text (the store's writes), or recordQuote's mapping of it (the guard's execution quote).
    if (code === "batch_voided" || (typeof message === "string" && message.includes("batch is voided: final"))) return true;
  }
  return false;
}

/** Status reads never pay: a busy store is a plain 503, an unreachable wallet a 502; anything else is the fixed 500 (`guarded`). */
export function statusProblem(e: unknown): Response | undefined {
  if (e instanceof StoreBusyError) return problem(503, "store_busy", "the database is busy; retry shortly", {}, { "Retry-After": "1" });
  if (e instanceof ZkoolTransportError || e instanceof ZkoolGraphqlError) {
    return problem(502, "wallet_unavailable", "the wallet did not answer, so the chain status is unknown; nothing is claimed; retry later");
  }
  return undefined;
}
