// Voiding a draft that cannot have paid (slice H5c; design H5c.1; R82). Allowed while there is no submission, or only
// a `failed_retryable` one (BTCPay cancels a payout unless it is InProgress or Completed). The void is recorded and
// final (Stripe: "cannot be undone"), and it releases the batch's memo claims in the same transaction, so its
// payables and memos can go into a new batch at today's rate. The 0019 triggers are the backstop for every rule.

import { and, eq, ne } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batches, batchVoids, memoClaims, submissions } from "../../db/schema.ts";
import { ExecutionError } from "../execution/types.ts";
import { getBatch, type BatchRecord } from "./batches.ts";

export type VoidErrorCode = "batch_not_found" | "batch_frozen" | "batch_voided";

export class VoidError extends ExecutionError {
  constructor(code: VoidErrorCode, detail: string) {
    super(code, detail);
  }
}

const FROZEN = "a payment attempt may have sent this batch, so it cannot be voided";
const VOIDED = "the batch is already voided";

/** Void the batch and release its memo claims; returns the batch as it now reads (with `voidedAt`). */
export async function voidBatch(db: ConsoleDb, orgId: string, batchId: string, opts: { now?: () => Date } = {}): Promise<BatchRecord> {
  const at = (opts.now ?? (() => new Date()))().toISOString();
  try {
    await runSync(() =>
      db.transaction(
        (tx) => {
          // Checked inside the write transaction (BEGIN IMMEDIATE), so a concurrent retry is either before (and seen
          // here as `submitting`) or after (and refused by `submissions_not_voided_retry`).
          if (!tx.select({ id: batches.id }).from(batches).where(and(eq(batches.orgId, orgId), eq(batches.id, batchId))).get()) throw new VoidError("batch_not_found", "no batch with this id");
          if (tx.select({ b: batchVoids.batchId }).from(batchVoids).where(and(eq(batchVoids.orgId, orgId), eq(batchVoids.batchId, batchId))).get()) throw new VoidError("batch_voided", VOIDED);
          const mayHavePaid = tx.select({ s: submissions.state }).from(submissions)
            .where(and(eq(submissions.orgId, orgId), eq(submissions.batchId, batchId), ne(submissions.state, "failed_retryable"))).get();
          if (mayHavePaid) throw new VoidError("batch_frozen", FROZEN);
          tx.insert(batchVoids).values({ orgId, batchId, voidedAt: at }).run();
          tx.delete(memoClaims).where(and(eq(memoClaims.orgId, orgId), eq(memoClaims.batchId, batchId))).run();
        },
        { behavior: "immediate" },
      ),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/batch is frozen: a submission may have paid/.test(message)) throw new VoidError("batch_frozen", FROZEN);
    if (/UNIQUE constraint failed: batch_voids\./.test(message)) throw new VoidError("batch_voided", VOIDED);
    throw e;
  }
  return (await getBatch(db, orgId, batchId))!;
}
