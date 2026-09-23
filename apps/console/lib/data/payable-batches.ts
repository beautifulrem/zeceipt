// A batch made from payables (slice H5a; REQ-CON-3 → REQ-CON-4; design H5a.1): each payable becomes a line that
// copies its recipient's name and address (B1), carries its reference as the memo and its USD cents, and pays
// zat = floor(cents × 10^8 / (100 × rate)) at one quote, recorded as the batch's only lock in the same write
// transaction (BTCPay's fixed payout rate; R80). A payable is in at most one batch (the partial unique index).

import { and, eq, inArray } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batchItems, batches, payables, rateQuotes, recipients } from "../../db/schema.ts";
import { MAX_ZAT } from "../execution/money.ts";
import type { Network } from "../execution/types.ts";
import { batchProblems } from "../execution/validate.ts";
import { usdCentsToZat } from "../rates/convert.ts";
import type { RateQuote } from "../rates/kraken.ts";
import { BatchInvalidError, newBatchId, zatToDb, type BatchProblem, type BatchRecord } from "./batches.ts";
import { quoteProblem, toStored, type StoredQuote } from "./rates.ts";
import { isPlainText } from "./text.ts";

/** B1's line limit, which is also Bill.com's bulk-payment limit (R80). */
export const MAX_PAYABLES = 50;

export interface PayableBatchInput {
  orgId: string;
  network: Network;
  title: string;
  payableIds: string[];
}

type Db = Pick<ConsoleDb, "select">;

/** The read checks, all listed together: the title, the count, and each id (repeated, unknown, already in a batch). */
function readProblems(db: Db, input: PayableBatchInput): BatchProblem[] {
  const problems: BatchProblem[] = [];
  if (!isPlainText(input.title, 1, 200)) problems.push({ code: "title_invalid", detail: "title must be 1–200 characters of plain text" });
  if (input.payableIds.length === 0) problems.push({ code: "empty_batch", detail: "choose at least one payable" });
  if (input.payableIds.length > MAX_PAYABLES) problems.push({ code: "too_many_recipients", detail: `${input.payableIds.length} payables > limit ${MAX_PAYABLES}` });
  const ids = [...new Set(input.payableIds)];
  const known = new Set(ids.length ? db.select({ id: payables.id }).from(payables).where(and(eq(payables.orgId, input.orgId), inArray(payables.id, ids))).all().map((r) => r.id) : []);
  const held = new Map(ids.length ? db.select({ ref: batchItems.payableRef, batchId: batchItems.batchId }).from(batchItems).where(and(eq(batchItems.orgId, input.orgId), inArray(batchItems.payableRef, ids))).all().map((r) => [r.ref!, r.batchId]) : []);
  const seen = new Set<string>();
  input.payableIds.forEach((id, i) => {
    if (seen.has(id)) problems.push({ code: "payable_repeated", itemIndex: i, detail: "this payable is already chosen above" });
    else if (!known.has(id)) problems.push({ code: "payable_unknown", itemIndex: i, detail: "no payable with this id in this organisation" });
    else if (held.has(id)) problems.push({ code: "payable_taken", itemIndex: i, detail: `this payable is already in batch ${held.get(id)}` });
    seen.add(id);
  });
  return problems;
}

/** The read checks, before a quote is spent (design H5a.1.8); `createBatchFromPayables` repeats them inside its transaction. */
export function payableBatchProblems(db: ConsoleDb, input: PayableBatchInput): Promise<BatchProblem[]> {
  return runSync(() => readProblems(db, input));
}

/** The partial unique index refused a line: another batch took the payable between our check and our insert. */
function isTakenConflict(e: unknown): boolean {
  for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) {
    const { code, message } = c as { code?: unknown; message?: unknown };
    if (code === "SQLITE_CONSTRAINT_UNIQUE" && typeof message === "string" && message.includes("batch_items.org_id, batch_items.payable_ref")) return true;
  }
  return false;
}

export async function createBatchFromPayables(
  db: ConsoleDb,
  input: PayableBatchInput & { quote: RateQuote },
  opts: { now?: () => Date; newId?: () => string } = {},
): Promise<{ batch: BatchRecord; lock: StoredQuote }> {
  const bad = quoteProblem(input.quote);
  if (bad) throw new RangeError(`quote is invalid: ${bad}`);
  const now = (opts.now ?? (() => new Date()))();
  const id = (opts.newId ?? (() => newBatchId(now.getTime())))();
  const at = now.toISOString();
  const run = () =>
    db.transaction(
      (tx) => {
        const problems = readProblems(tx, input);
        if (problems.length) throw new BatchInvalidError(problems);
        const rows = tx.select({ p: payables, r: recipients }).from(payables)
          .innerJoin(recipients, and(eq(recipients.orgId, payables.orgId), eq(recipients.id, payables.recipientId)))
          .where(and(eq(payables.orgId, input.orgId), inArray(payables.id, input.payableIds))).all();
        const byId = new Map(rows.map((x) => [x.p.id, x]));
        const items = input.payableIds.map((pid, idx) => {
          const { p, r } = byId.get(pid)!;
          return { idx, payableId: p.id, label: r.displayName, address: r.address, zat: usdCentsToZat(p.usdCents, input.quote.rate), memo: p.reference, payableRef: p.id, usdCents: p.usdCents };
        });
        const out: BatchProblem[] = [];
        items.forEach((it, i) => {
          const dollars = `$${Math.floor(it.usdCents / 100)}.${String(it.usdCents % 100).padStart(2, "0")}`;
          if (it.zat < 1n || it.zat > MAX_ZAT) out.push({ code: "amount_out_of_range", itemIndex: i, detail: `${dollars} at ${input.quote.rate} USD/ZEC is ${it.zat} zatoshi, outside 1 to ${MAX_ZAT}` });
        });
        // Preflight's static rules too (addresses for the network, memos), so a payables batch is as valid as any.
        if (!out.length) out.push(...batchProblems({ id, network: input.network, items }, { maxRecipients: MAX_PAYABLES }));
        if (out.length) throw new BatchInvalidError(out);
        tx.insert(batches).values({ orgId: input.orgId, id, network: input.network, title: input.title, createdAt: at, updatedAt: at }).run();
        for (const it of items) {
          tx.insert(batchItems).values({ orgId: input.orgId, batchId: id, idx: it.idx, payableId: it.payableId, label: it.label, address: it.address, zat: zatToDb(it.zat), memo: it.memo, payableRef: it.payableRef, usdCents: it.usdCents }).run();
        }
        // The lock of record: seq 1, after every line (the 0017 triggers require that order).
        const q = input.quote;
        const lockRow = { orgId: input.orgId, batchId: id, seq: 1, purpose: "lock" as const, source: q.source, pair: q.pair, bid: q.bid, ask: q.ask, last: q.last, rate: q.rate, fetchedAt: q.fetchedAt, recordedAt: at };
        tx.insert(rateQuotes).values(lockRow).run();
        const batch: BatchRecord = { orgId: input.orgId, id, network: input.network, title: input.title, createdAt: at, items };
        return { batch, lock: toStored(lockRow) };
      },
      { behavior: "immediate" },
    );
  try {
    return await runSync(run);
  } catch (e) {
    if (!isTakenConflict(e)) throw e;
    // A concurrent batch took a payable after our checks: say which, as the checks would have.
    const problems = await payableBatchProblems(db, input);
    if (!problems.length) throw e;
    throw new BatchInvalidError(problems);
  }
}
