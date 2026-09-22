// Static batch rules (no network): the single rule set used by `ZkoolBackend.preflight` and by the
// console's batch repository, so a batch is never stored in a form the backend would refuse statically.

import { checkUnifiedAddress } from "./address.ts";
import { MAX_ZAT } from "./money.ts";
import type { Batch, PreflightProblem } from "./types.ts";

export const MEMO_MAX_BYTES = 512;

export function batchProblems(batch: Batch, opts: { maxRecipients: number }): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  if (batch.items.length === 0) problems.push({ code: "empty_batch", detail: "batch has no items" });
  if (batch.items.length > opts.maxRecipients) {
    problems.push({ code: "too_many_recipients", detail: `${batch.items.length} recipients > limit ${opts.maxRecipients}` });
  }
  const payables = new Set<string>();
  const memos = new Set<string>();
  batch.items.forEach((it, i) => {
    const a = checkUnifiedAddress(it.address, batch.network);
    if (!a.ok) problems.push({ code: a.code, itemIndex: i, detail: a.detail });
    if (it.zat <= 0n) problems.push({ code: "amount_nonpositive", itemIndex: i, detail: `amount ${it.zat} zat` });
    if (it.zat > MAX_ZAT) problems.push({ code: "amount_too_large", itemIndex: i, detail: `amount ${it.zat} zat > the 21M ZEC supply` });
    const bytes = Buffer.byteLength(it.memo, "utf8");
    // The memo is the payable reference: reconciliation and receipt matching need it.
    if (bytes === 0) problems.push({ code: "memo_empty", itemIndex: i, detail: "memo is empty (it must carry the payable reference)" });
    if (bytes > MEMO_MAX_BYTES) problems.push({ code: "memo_too_long", itemIndex: i, detail: `${bytes} bytes > ${MEMO_MAX_BYTES}` });
    if (payables.has(it.payableId)) problems.push({ code: "duplicate_payable", itemIndex: i, detail: `payable ${it.payableId} appears twice` });
    payables.add(it.payableId);
    // Memos are payable references (unique per org, REQ-CON-3) and the key for reconciliation.
    if (memos.has(it.memo)) problems.push({ code: "memo_duplicate", itemIndex: i, detail: `memo ${JSON.stringify(it.memo)} appears twice` });
    memos.add(it.memo);
  });
  return problems;
}
