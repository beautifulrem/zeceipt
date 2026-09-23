// Rate lock (slice G1c1; REQ-CON-4, NFR-8): lock a draft batch's ZEC/USD rate from the configured source and
// show the current lock. The lock is a sub-resource action answered whole, as Stripe's FX Quotes return the
// whole quote (R72). Order: the batch exists (404), it is not frozen (409, before spending a request on the
// source), a quote (502 on any failure: nothing is locked), then the record (a race with a submission ends in
// the trigger's batch_frozen, also 409). Errors are mapped by `code`, not by class: the library loads twice
// under Next.js (slice E1). The source's own text never reaches a response; its failure reason is a fixed word.

import { and, eq } from "drizzle-orm";
import { submissions } from "../../db/schema.ts";
import { batchNonce, getBatch } from "../data/batches.ts";
import { currentLock, recordQuote, type StoredQuote } from "../data/rates.ts";
import { serverContext } from "../server/context.ts";
import { HttpProblem, problem } from "./problem.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** The lock as the API shows it: exact decimal strings, the source, and both times. */
export function lockJson(q: StoredQuote) {
  return { seq: q.seq, source: q.source, pair: q.pair, bid: q.bid, ask: q.ask, last: q.last, rate: q.rate, fetchedAt: q.fetchedAt, recordedAt: q.recordedAt };
}
export type LockJson = ReturnType<typeof lockJson>;

const frozen = () => new HttpProblem(409, "batch_frozen", "the batch has a submission; its rate can no longer be locked");

/** `POST /api/batches/:id/rate-lock`: 201 with the new current lock. */
export async function lockRateResponse(id: string): Promise<Response> {
  const { config, db, quote } = serverContext();
  const rec = UUID_V7.test(id) ? await getBatch(db, config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  const submitted = db.select({ n: submissions.nonce }).from(submissions).where(and(eq(submissions.orgId, config.orgId), eq(submissions.nonce, batchNonce(rec)))).get();
  if (submitted) throw frozen();
  const q = await quote();
  const stored = await recordQuote(db, { orgId: config.orgId, batchId: rec.id, purpose: "lock", quote: q });
  return json(201, lockJson(stored));
}

/** The current lock of a batch, or null (for `GET /api/batches/:id`). */
export async function rateLockJson(orgId: string, batchId: string): Promise<LockJson | null> {
  const q = await currentLock(serverContext().db, orgId, batchId);
  return q ? lockJson(q) : null;
}

/** Domain failures of the rate lock, by code. */
export function ratesProblem(e: unknown): Response | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "rate_unavailable") {
    const reason = (e as { reason?: unknown }).reason;
    return problem(502, "rate_unavailable", "the ZEC/USD source did not give a usable quote; nothing was locked", { reason: typeof reason === "string" ? reason : "unknown" });
  }
  if (code === "batch_frozen") return frozen().response;
  if (code === "store_busy") return problem(503, "store_busy", "the database is busy; nothing was locked; retry shortly", {}, { "Retry-After": "1" });
  return undefined;
}
