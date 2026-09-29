// Approvals (slice I3; REQ-CON-5 as scaled: one approver).
// An approval is an HMAC-SHA256, under a key derived from the wrap key (`Keyring.approvalKey`), over a canonical
// message naming the batch's lines, its current lock and the backend that will pay. It binds content the way a Safe
// confirmation binds `safe_tx_hash` and BTCPay's approve names the revision seen (R87). Validity is recomputed on
// every read and never stored: a re-lock (a new lock seq) or any change to a line, by any path, stops the HMAC from
// verifying, so "any edit invalidates approvals" holds by construction.

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { approvals } from "../../db/schema.ts";
import type { Keyring } from "../crypto/seal.ts";
import { ExecutionError } from "../execution/types.ts";
import type { BatchRecord } from "./batches.ts";
import type { StoredQuote } from "./rates.ts";

/** The backend an approval names (design I3.1.2.4): the wallet account that will pay. */
export function backendId(zkoolAccount: number): string {
  return `zkool account ${zkoolAccount}`;
}

/** The only approver until the console has sign-in (RSK-24): a typed name would be an unverified claim. */
export const APPROVER = "operator";

export interface Approval {
  seq: number;
  approver: string;
  approvedAt: string;
  lockSeq: number;
}

export class ApprovalError extends ExecutionError {
  constructor(code: "batch_voided" | "batch_frozen" | "lock_unknown", detail: string) {
    super(code, detail);
  }
}

/**
 * The canonical message (design I3.1.2): JSON of a fixed array, so there are no keys to order, with zat as a decimal
 * string. Lines in index order (the index is each receipt's output identity); the label is display only and left out.
 */
export function approvalMessage(rec: Pick<BatchRecord, "orgId" | "id" | "network" | "items">, lock: Pick<StoredQuote, "seq" | "rate">, backend: string): string {
  const lines = [...rec.items].sort((a, b) => a.idx - b.idx).map((i) => [i.idx, i.payableId, i.address, i.zat.toString(), i.memo]);
  return JSON.stringify(["zeceipt approval v1", rec.orgId, rec.id, rec.network, backend, lock.seq, lock.rate, lines]);
}

/** HMAC-SHA256 of the message under the org's approval key for `kid`, as lowercase hex. */
export function approvalHmac(keyring: Keyring, kid: string, orgId: string, message: string): string {
  return createHmac("sha256", keyring.approvalKey(kid, orgId)).update(message, "utf8").digest("hex");
}

function verifies(keyring: Keyring, row: { kid: string; hmac: string }, orgId: string, message: string): boolean {
  // A kid the keyring no longer holds cannot be checked: not valid (fail closed; approve again).
  if (!keyring.has(row.kid)) return false;
  const want = Buffer.from(approvalHmac(keyring, row.kid, orgId, message), "hex");
  const got = Buffer.from(row.hmac, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const toApproval = (r: typeof approvals.$inferSelect): Approval => ({ seq: r.seq, approver: r.approver, approvedAt: r.approvedAt, lockSeq: r.lockSeq });

/** The newest approval for the batch's current lock that verifies over the batch as it is now, if any. */
export function validApproval(db: ConsoleDb, keyring: Keyring, rec: BatchRecord, lock: StoredQuote | undefined, backend: string): Promise<Approval | undefined> {
  if (!lock) return Promise.resolve(undefined);
  const message = approvalMessage(rec, lock, backend);
  return runSync(() => {
    const rows = db.select().from(approvals)
      .where(and(eq(approvals.orgId, rec.orgId), eq(approvals.batchId, rec.id), eq(approvals.lockSeq, lock.seq)))
      .orderBy(desc(approvals.seq)).all();
    const row = rows.find((r) => verifies(keyring, r, rec.orgId, message));
    return row ? toApproval(row) : undefined;
  });
}

/** Record an approval of the batch as it is now, at `lock`, for `backend`; the triggers refuse a voided or frozen batch. */
export async function recordApproval(
  db: ConsoleDb,
  keyring: Keyring,
  args: { rec: BatchRecord; lock: StoredQuote; backend: string; now?: () => Date },
): Promise<Approval> {
  const { rec, lock, backend } = args;
  const kid = keyring.current;
  const hmac = approvalHmac(keyring, kid, rec.orgId, approvalMessage(rec, lock, backend));
  const approvedAt = (args.now ?? (() => new Date()))().toISOString();
  try {
    return await runSync(() =>
      db.transaction(
        (tx) => {
          // seq inside the write transaction (BEGIN IMMEDIATE), as recordQuote takes its seq.
          const { next } = tx
            .select({ next: sql<number>`coalesce(max(${approvals.seq}), 0) + 1` })
            .from(approvals)
            .where(and(eq(approvals.orgId, rec.orgId), eq(approvals.batchId, rec.id)))
            .get()!;
          const row = { orgId: rec.orgId, batchId: rec.id, seq: next, approver: APPROVER, approvedAt, lockSeq: lock.seq, kid, hmac };
          tx.insert(approvals).values(row).run();
          return toApproval(row);
        },
        { behavior: "immediate" },
      ),
    );
  } catch (e) {
    if (e instanceof Error && /batch is voided: final/.test(e.message)) throw new ApprovalError("batch_voided", "the batch is voided: it can no longer be approved");
    if (e instanceof Error && /batch is frozen: a submission may have paid/.test(e.message)) throw new ApprovalError("batch_frozen", "the batch has a payment attempt that may have paid; approving it again means nothing");
    if (e instanceof Error && /approval names no lock of this batch/.test(e.message)) throw new ApprovalError("lock_unknown", "the approval names a lock this batch does not have");
    throw e;
  }
}
