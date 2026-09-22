// Receipt repository (design `.trellis/tasks/09-23-receipts-sealed/design.md`): record the receipts
// `autoIssue` produced for a batch (only for the batch's own broadcast transaction, each matched to its item,
// idempotently and atomically), list them back decrypted, and re-wrap them under the newest key.
// The receipt envelope and URL are sealed (they contain the output's OCK); the AAD is the row's identity.

import { and, asc, eq, ne } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batchItems, receipts, submissions } from "../../db/schema.ts";
import { Keyring, open, seal } from "../crypto/seal.ts";
import { ExecutionError } from "../execution/types.ts";
import type { AutoIssueResult, IssuedReceipt } from "../issuance/auto-issue.ts";
import { batchNonce, getBatch } from "./batches.ts";

type Pool = "sapling" | "orchard" | "ironwood";
const POOLS: readonly Pool[] = ["sapling", "orchard", "ironwood"];

export class ReceiptRecordError extends ExecutionError {
  constructor(code: "batch_unknown" | "batch_not_broadcast" | "receipt_mismatch", detail: string) {
    super(code, detail);
  }
}

export interface RecordResult {
  /** Item indexes whose receipt was written now. */
  inserted: number[];
  /** Item indexes that already had this receipt (first receipt per output wins; nothing was replaced). */
  existing: number[];
}

export interface StoredReceipt {
  idx: number;
  payableId: string;
  txid: string;
  pool: Pool;
  outputIndex: number;
  valueZat: bigint;
  recipient: string;
  memo: string;
  issuedAt: string;
  verifiedAt: string;
  sealedKid: string;
  receipt: Record<string, unknown>;
  url: string;
}

const context = (txid: string, pool: string, outputIndex: number) => ({ purpose: "receipt", txid, pool, index: outputIndex });

export async function recordReceipts(
  db: ConsoleDb,
  keyring: Keyring,
  args: { orgId: string; batchId: string; issued: Extract<AutoIssueResult, { state: "issued" }>; now?: () => Date },
): Promise<RecordResult> {
  const { orgId, batchId, issued } = args;
  const batch = await getBatch(db, orgId, batchId);
  if (!batch) throw new ReceiptRecordError("batch_unknown", `no batch ${batchId}`);
  const sub = db.select().from(submissions).where(and(eq(submissions.orgId, orgId), eq(submissions.nonce, batchNonce(batch)))).get();
  if (!sub || sub.state !== "broadcast" || sub.txid !== issued.txid) {
    throw new ReceiptRecordError("batch_not_broadcast", `batch ${batchId} was not broadcast as ${issued.txid} (submission: ${sub ? `${sub.state} ${sub.txid ?? "no txid"}` : "none"})`);
  }
  // Every receipt must be for this transaction and match exactly one item (payable id, memo, value).
  const problems: string[] = [];
  const seenItems = new Set<number>();
  const seenOutputs = new Set<string>();
  const rows = issued.receipts.map((r: IssuedReceipt) => {
    const item = batch.items.find((i) => i.payableId === r.payableId);
    const pool = r.recovered.pool as Pool;
    const out = `${pool}:${r.recovered.index}`;
    if (!item) problems.push(`payable ${r.payableId} is not in batch ${batchId}`);
    else {
      if (r.recovered.memo.kind !== "text" || r.recovered.memo.text !== item.memo) problems.push(`payable ${r.payableId}: memo differs from the item`);
      if (BigInt(r.recovered.value_zat) !== item.zat) problems.push(`payable ${r.payableId}: value ${r.recovered.value_zat} ≠ ${item.zat}`);
      if (seenItems.has(item.idx)) problems.push(`payable ${r.payableId} has two receipts`);
      seenItems.add(item.idx);
    }
    if (r.receipt.txid !== issued.txid) problems.push(`payable ${r.payableId}: receipt is for another transaction`);
    if (!POOLS.includes(pool)) problems.push(`payable ${r.payableId}: unknown pool ${r.recovered.pool}`);
    if (r.outputIndex !== r.recovered.index) problems.push(`payable ${r.payableId}: output index mismatch`);
    if (seenOutputs.has(out)) problems.push(`output ${out} is claimed twice`);
    seenOutputs.add(out);
    return { r, item, pool };
  });
  if (problems.length) throw new ReceiptRecordError("receipt_mismatch", problems.join("; "));

  const now = (args.now ?? (() => new Date()))().toISOString();
  const sealedRows = rows.map(({ r, item, pool }) => ({
    orgId,
    txid: issued.txid,
    pool,
    outputIndex: r.recovered.index,
    batchId,
    idx: item!.idx,
    valueZat: Number(r.recovered.value_zat),
    recipient: r.recovered.recipient,
    memoText: item!.memo,
    issuedAt: now,
    verifiedAt: now,
    sealed: seal(keyring, orgId, context(issued.txid, pool, r.recovered.index), Buffer.from(JSON.stringify({ receipt: r.receipt, url: r.url }), "utf8")),
    sealedKid: keyring.current,
  }));
  return runSync(() =>
    db.transaction(
      (tx) => {
        // Re-check inside the write transaction: the submission must still be this broadcast.
        const now2 = tx.select().from(submissions).where(and(eq(submissions.orgId, orgId), eq(submissions.nonce, batchNonce(batch)))).get();
        if (!now2 || now2.state !== "broadcast" || now2.txid !== issued.txid) {
          throw new ReceiptRecordError("batch_not_broadcast", `batch ${batchId} is no longer broadcast as ${issued.txid}`);
        }
        const result: RecordResult = { inserted: [], existing: [] };
        for (const row of sealedRows) {
          const w = tx.insert(receipts).values(row).onConflictDoNothing().run();
          if (w.changes === 1) {
            result.inserted.push(row.idx);
            continue;
          }
          // Not written: it must be this very output already recorded for this item; anything else is a conflict.
          const have = tx.select().from(receipts).where(and(eq(receipts.orgId, orgId), eq(receipts.batchId, batchId), eq(receipts.idx, row.idx))).get();
          if (have && have.txid === row.txid && have.pool === row.pool && have.outputIndex === row.outputIndex) {
            result.existing.push(row.idx);
            continue;
          }
          const holder = tx
            .select()
            .from(receipts)
            .where(and(eq(receipts.orgId, orgId), eq(receipts.txid, row.txid), eq(receipts.pool, row.pool), eq(receipts.outputIndex, row.outputIndex)))
            .get();
          throw new ReceiptRecordError(
            "receipt_mismatch",
            have
              ? `item ${row.idx} already has a receipt for another output (${have.pool}:${have.outputIndex})`
              : `output ${row.pool}:${row.outputIndex} of ${row.txid} already has a receipt for batch ${holder?.batchId} item ${holder?.idx}`,
          );
        }
        return result;
      },
      { behavior: "immediate" },
    ),
  );
}

export function listReceipts(db: ConsoleDb, keyring: Keyring, orgId: string, batchId: string): Promise<StoredReceipt[]> {
  return runSync(() =>
    db
      .select({ r: receipts, payableId: batchItems.payableId })
      .from(receipts)
      .innerJoin(batchItems, and(eq(batchItems.orgId, receipts.orgId), eq(batchItems.batchId, receipts.batchId), eq(batchItems.idx, receipts.idx)))
      .where(and(eq(receipts.orgId, orgId), eq(receipts.batchId, batchId)))
      .orderBy(asc(receipts.idx))
      .all()
      .map(({ r, payableId }) => {
        const payload = JSON.parse(open(keyring, orgId, context(r.txid, r.pool, r.outputIndex), r.sealed).toString("utf8")) as { receipt: Record<string, unknown>; url: string };
        return {
          idx: r.idx,
          payableId,
          txid: r.txid,
          pool: r.pool,
          outputIndex: r.outputIndex,
          valueZat: BigInt(r.valueZat),
          recipient: r.recipient,
          memo: r.memoText,
          issuedAt: r.issuedAt,
          verifiedAt: r.verifiedAt,
          sealedKid: r.sealedKid,
          receipt: payload.receipt,
          url: payload.url,
        };
      }),
  );
}

/** Re-seal every receipt of `orgId` not yet under the keyring's newest key (key rotation, `05` §1). */
export function rewrapReceipts(db: ConsoleDb, keyring: Keyring, orgId: string): Promise<number> {
  return runSync(() =>
    db.transaction(
      (tx) => {
        const stale = tx.select().from(receipts).where(and(eq(receipts.orgId, orgId), ne(receipts.sealedKid, keyring.current))).all();
        for (const r of stale) {
          const ctx = context(r.txid, r.pool, r.outputIndex);
          const sealed = seal(keyring, orgId, ctx, open(keyring, orgId, ctx, r.sealed));
          tx.update(receipts)
            .set({ sealed, sealedKid: keyring.current })
            .where(and(eq(receipts.orgId, orgId), eq(receipts.txid, r.txid), eq(receipts.pool, r.pool), eq(receipts.outputIndex, r.outputIndex), eq(receipts.sealed, r.sealed)))
            .run();
        }
        return stale.length;
      },
      { behavior: "immediate" },
    ),
  );
}
