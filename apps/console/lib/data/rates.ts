// Rate quote repository (slice G1b; REQ-CON-4, NFR-8): an append-only history of ZEC/USD quotes per batch.
// A `lock` converts and may be re-taken while the batch is a draft (the latest lock is current); an
// `execution` quote is taken at submit (slice G2). The schema enforces the rest: no update, delete or
// replace, and no lock once a submission that may have paid exists (migrations 0011, 0012, 0014: a
// `failed_retryable` submission, which proves nothing was paid, still allows a re-lock).

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { rateQuotes } from "../../db/schema.ts";
import { ExecutionError } from "../execution/types.ts";
import { compareDecimal, isPositiveDecimal } from "../rates/decimal.ts";
import type { RateQuote } from "../rates/kraken.ts";
import { getBatch } from "./batches.ts";

export type QuotePurpose = "lock" | "execution";

export interface StoredQuote {
  seq: number;
  purpose: QuotePurpose;
  source: string;
  pair: string;
  bid: string;
  ask: string;
  last: string;
  rate: string;
  fetchedAt: string;
  recordedAt: string;
}

export class RateRecordError extends ExecutionError {
  constructor(code: "batch_unknown" | "batch_frozen" | "quote_invalid" | "rate_fixed" | "batch_voided", detail: string) {
    super(code, detail);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The quote must be what G1a produces: positive decimals, bid ≤ ask, rate = bid, an ISO time. */
export function quoteProblem(q: RateQuote): string | undefined {
  for (const [name, v] of [["bid", q.bid], ["ask", q.ask], ["last", q.last]] as const) {
    if (typeof v !== "string" || !isPositiveDecimal(v)) return `${name} is not a positive decimal`;
  }
  if (compareDecimal(q.bid, q.ask) > 0) return "bid is above ask";
  if (q.rate !== q.bid) return "rate must be the bid";
  if (typeof q.fetchedAt !== "string" || !ISO.test(q.fetchedAt)) return "fetchedAt must be ISO 8601 UTC with milliseconds";
  return undefined;
}

const FROZEN = /batch is frozen: a submission exists/;
const FIXED = /rate is fixed: the batch was made from payables/;
/** Why a batch made from payables cannot be re-locked (slice H5a; the API's `rate_fixed`). */
// Voiding (slice H5c) frees the payables, so a new batch from them can be made at today's rate.
export const FIXED_DETAIL = "the amounts were converted from the payables at this batch's lock, so the batch cannot be re-locked; to pay at another rate, void this draft (POST /api/batches/{id}/void; allowed while nothing may have been sent) and make a new batch from its payables";

export async function recordQuote(
  db: ConsoleDb,
  args: { orgId: string; batchId: string; purpose: QuotePurpose; quote: RateQuote; now?: () => Date },
): Promise<StoredQuote> {
  const { orgId, batchId, purpose, quote } = args;
  const problem = quoteProblem(quote);
  if (problem) throw new RateRecordError("quote_invalid", problem);
  if (!(await getBatch(db, orgId, batchId))) throw new RateRecordError("batch_unknown", `no batch ${batchId}`);
  const recordedAt = (args.now ?? (() => new Date()))().toISOString();
  try {
    return await runSync(() =>
      db.transaction(
        (tx) => {
          // seq is taken inside the write transaction (BEGIN IMMEDIATE): concurrent writers serialise on the
          // SQLite write lock, so they can never take the same seq; the primary key is the backstop.
          const { next } = tx
            .select({ next: sql<number>`coalesce(max(${rateQuotes.seq}), 0) + 1` })
            .from(rateQuotes)
            .where(and(eq(rateQuotes.orgId, orgId), eq(rateQuotes.batchId, batchId)))
            .get()!;
          const row = { orgId, batchId, seq: next, purpose, source: quote.source, pair: quote.pair, bid: quote.bid, ask: quote.ask, last: quote.last, rate: quote.rate, fetchedAt: quote.fetchedAt, recordedAt };
          tx.insert(rateQuotes).values(row).run();
          return toStored(row);
        },
        { behavior: "immediate" },
      ),
    );
  } catch (e) {
    if (e instanceof Error && FROZEN.test(e.message)) throw new RateRecordError("batch_frozen", "the batch has a payment attempt that may have paid; its rate can no longer be locked");
    if (e instanceof Error && FIXED.test(e.message)) throw new RateRecordError("rate_fixed", FIXED_DETAIL);
    // A void between the route's check and this insert (slice H5c): the rate_quotes_not_voided trigger.
    if (e instanceof Error && /batch is voided: final/.test(e.message)) throw new RateRecordError("batch_voided", "the batch is voided: its rate can no longer be locked");
    throw e;
  }
}

/** The latest lock quote of the batch, or undefined when it has never been locked. */
export function currentLock(db: ConsoleDb, orgId: string, batchId: string): Promise<StoredQuote | undefined> {
  return runSync(() => {
    const row = db.select().from(rateQuotes)
      .where(and(eq(rateQuotes.orgId, orgId), eq(rateQuotes.batchId, batchId), eq(rateQuotes.purpose, "lock")))
      .orderBy(desc(rateQuotes.seq)).limit(1).get();
    return row ? toStored(row) : undefined;
  });
}

/** Every quote of the batch, oldest first. */
export function listQuotes(db: ConsoleDb, orgId: string, batchId: string): Promise<StoredQuote[]> {
  return runSync(() =>
    db.select().from(rateQuotes)
      .where(and(eq(rateQuotes.orgId, orgId), eq(rateQuotes.batchId, batchId)))
      .orderBy(asc(rateQuotes.seq)).all().map(toStored),
  );
}

export function toStored(r: typeof rateQuotes.$inferSelect): StoredQuote {
  return { seq: r.seq, purpose: r.purpose, source: r.source, pair: r.pair, bid: r.bid, ask: r.ask, last: r.last, rate: r.rate, fetchedAt: r.fetchedAt, recordedAt: r.recordedAt };
}
