// The rows of the OpenZcash-compatible export (slice X2b; REQ-INT-2; `05` §3.1): one per issued receipt, in line
// order, with what the writer (`lib/export/openzcash.ts`) needs. Reads only; the receipt links are decrypted here and
// nowhere stored (they carry each output's OCK).

import { and, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batchItems, payables, submissions } from "../../db/schema.ts";
import type { Keyring } from "../crypto/seal.ts";
import type { ExportLine } from "../export/openzcash.ts";
import { batchNonce } from "./batches.ts";
import { currentLock } from "./rates.ts";
import { listReceipts } from "./receipts.ts";

export interface ExportRows {
  lines: ExportLine[];
  /** How many lines the batch has: more than `lines` when some receipts are not issued yet (a partial export). */
  batchLines: number;
  /** Line indexes whose receipt did not open (unknown key, tampering): the export refuses rather than drop them. */
  unreadable: number[];
}

/**
 * The export's rows for one batch. Recipient is the line's label, the name copied when the line was made, so a later
 * payee edit never changes what was paid; Category comes from the payable of a line made from one; Date is the
 * broadcast time of the batch's submission when its txid is the receipt's (else none); Rate is the batch's lock when
 * every line came from a payable, whose dollars that rate converted (`05` §3.1).
 */
export async function exportLines(db: ConsoleDb, keyring: Keyring, orgId: string, batchId: string, host: string): Promise<ExportRows> {
  const receipts = await listReceipts(db, keyring, orgId, batchId, host);
  const { items, submission } = await runSync(() => ({
    items: db
      .select({ idx: batchItems.idx, label: batchItems.label, memo: batchItems.memo, zat: batchItems.zat, usdCents: batchItems.usdCents, payableRef: batchItems.payableRef, kind: payables.kind })
      .from(batchItems)
      .leftJoin(payables, and(eq(payables.orgId, batchItems.orgId), eq(payables.id, batchItems.payableRef)))
      .where(and(eq(batchItems.orgId, orgId), eq(batchItems.batchId, batchId)))
      .all(),
    submission: db
      .select({ txid: submissions.txid, broadcastAt: submissions.broadcastAt })
      .from(submissions)
      .where(and(eq(submissions.orgId, orgId), eq(submissions.nonce, batchNonce({ id: batchId }))))
      .get(),
  }));
  const byIdx = new Map(items.map((i) => [i.idx, i]));
  const fromPayables = items.length > 0 && items.every((i) => i.payableRef !== null);
  const rate = fromPayables ? ((await currentLock(db, orgId, batchId))?.rate ?? null) : null;

  const lines: ExportLine[] = [];
  const unreadable: number[] = [];
  for (const r of receipts) {
    const item = byIdx.get(r.idx);
    if (r.openError || !r.url || !item) {
      unreadable.push(r.idx);
      continue;
    }
    lines.push({
      recipientName: item.label,
      memo: item.memo,
      kind: item.payableRef !== null ? item.kind : null,
      usdCents: item.usdCents,
      zat: BigInt(item.zat),
      broadcastAt: submission?.txid === r.txid ? (submission.broadcastAt ?? null) : null,
      txid: r.txid,
      receiptUrl: r.url,
      rate,
    });
  }
  return { lines, unreadable, batchLines: items.length };
}
