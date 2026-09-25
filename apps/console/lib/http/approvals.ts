// `POST /api/batches/{id}/approve` (slice I3; REQ-CON-5 as scaled; design I3.1.6). The body names what the approver
// saw, the total and the lock (BTCPay's approve names the payout `revision` and answers `old-revision` when it
// changed; R87). Order:
// - 409 `custody_external`;
// - 404;
// - 409 `batch_voided`;
// - 400 `body_invalid`;
// - 409 `batch_frozen` (an attempt may have paid);
// - 409 `rate_not_locked`;
// - 422 `confirmation_mismatch`;
// - 409 `approval_stale` (re-locked since the approver saw it).
// Then 200 with the approval already valid for the batch as it is now (no second row), or 201 with a new one.
// Mapped by `code` (E1). Shared by the route and the page's Server Action, so both answer the same.

import { z } from "zod";
import { recordApproval, validApproval, type Approval } from "../data/approvals.ts";
import { getBatch, rateLockFrozen } from "../data/batches.ts";
import { currentLock } from "../data/rates.ts";
import { approvalCheck, serverContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";

export const ApproveBody = z.strictObject({
  confirmTotalZat: z.string().regex(/^[0-9]{1,17}$/),
  lockSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const statusPath = (id: string) => `/api/batches/${id}/status`;

const frozen = () => new HttpProblem(409, "batch_frozen", "the batch has a payment attempt that may have paid; nothing was approved");
const voided = () => new HttpProblem(409, "batch_voided", "the batch is voided: it can never be paid; nothing was approved");

export function approvalJson(a: Approval) {
  return { seq: a.seq, approvedAt: a.approvedAt, lockSeq: a.lockSeq, approver: a.approver };
}

/** `POST /api/batches/:id/approve` with `{"confirmTotalZat": "<total>", "lockSeq": <n>}`. */
export function approveResponse(req: Request, id: string): Promise<Response> {
  return approveBatch(id, () => readJson(req));
}

export async function approveBatch(id: string, readBody: () => Promise<unknown>): Promise<Response> {
  const ctx = serverContext();
  if (!ctx.backend) throw new HttpProblem(409, "custody_external", "this console runs in external-signer custody and never pays, so it takes no approvals");
  const rec = UUID_V7.test(id) ? await getBatch(ctx.db, ctx.config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  if (rec.voidedAt !== undefined) throw voided();
  const parsed = ApproveBody.safeParse(await readBody());
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new HttpProblem(400, "body_invalid", 'send {"confirmTotalZat": "<the batch total in zatoshi>", "lockSeq": <the current lock\'s seq>}; nothing was approved', { issues });
  }
  if (await rateLockFrozen(ctx.db, rec)) throw frozen();
  const lock = await currentLock(ctx.db, ctx.config.orgId, rec.id);
  if (!lock) throw new HttpProblem(409, "rate_not_locked", "lock the batch's ZEC/USD rate before approving (POST /api/batches/{id}/rate-lock); nothing was approved");
  const total = rec.items.reduce((s, i) => s + i.zat, 0n);
  if (BigInt(parsed.data.confirmTotalZat) !== total) {
    throw new HttpProblem(422, "confirmation_mismatch", "confirmTotalZat does not equal this batch's total; nothing was approved");
  }
  if (parsed.data.lockSeq !== lock.seq) {
    throw new HttpProblem(409, "approval_stale", `the rate was re-locked since (the current lock is ${lock.seq}, the approval named ${parsed.data.lockSeq}); review the batch at the current lock and approve again; nothing was approved`, { lockSeq: lock.seq });
  }
  const check = approvalCheck(ctx);
  const existing = await validApproval(ctx.db, check.keyring, rec, lock, check.backend);
  const approval = existing ?? (await recordApproval(ctx.db, check.keyring, { rec, lock, backend: check.backend }));
  return new Response(JSON.stringify({ batchId: rec.id, approval: approvalJson(approval) }), {
    status: existing ? 200 : 201,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Location: statusPath(rec.id) },
  });
}

/** The data layer's refusals (the triggers, raced), by code. */
export function approvalsProblem(e: unknown): Response | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "batch_voided") return voided().response;
  if (code === "batch_frozen") return frozen().response;
  if (code === "store_busy") return problem(503, "store_busy", "the database is busy; nothing was approved; retry shortly", {}, { "Retry-After": "1" });
  return undefined;
}
