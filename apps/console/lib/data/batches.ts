// Batch repository (design `.trellis/tasks/09-23-batches-schema/design.md`): create a validated batch,
// load it back as exactly the `Batch` the execution library pays, list batches with totals, and derive
// the batch's nonce. A batch is immutable once created here, and frozen by triggers once submitted.

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batchItems, batches, batchVoids, payables, submissions } from "../../db/schema.ts";
import { ExecutionError, type Batch, type Network, type PreflightProblem, type PreflightProblemCode } from "../execution/types.ts";
import { batchProblems } from "../execution/validate.ts";
import { hasInvisible, hasOtherSpace, isPlainText } from "./text.ts";

export interface BatchItemInput {
  payableId: string;
  /** Payee display label, copied onto the item (default ""). */
  label?: string;
  address: string;
  zat: bigint;
  memo: string;
}

export interface BatchRecord {
  orgId: string;
  id: string;
  network: Network;
  title: string;
  createdAt: string;
  items: (Required<BatchItemInput> & { idx: number; payableRef?: string; usdCents?: number })[];
  /** When the batch was voided (slice H5c); absent while it is live. */
  voidedAt?: string;
}

export interface BatchSummary {
  id: string;
  network: Network;
  title: string;
  createdAt: string;
  itemCount: number;
  totalZat: bigint;
  /** Voided (slice H5c). */
  voided: boolean;
}

/** Problems the repository adds to preflight's static rules: fields the console stores but the chain never sees. */
export type BatchProblemCode =
  | PreflightProblemCode
  | "title_invalid"
  | "payable_id_invalid"
  | "label_invalid"
  // A batch made from payables (slice H5a):
  | "payable_unknown"
  | "payable_repeated"
  | "payable_taken"
  | "amount_out_of_range"
  // Across batches (review H5a round 1): a memo already used by another batch of the org, and a hand-made line
  // carrying a payable's id or reference (payables are paid only through a batch made from payables).
  | "memo_taken"
  | "payable_reserved"
  // Slice H7: a hand-typed memo with invisible characters or another space (it is a reference the recipient reads).
  | "memo_invisible";
export interface BatchProblem extends Omit<PreflightProblem, "code"> {
  code: BatchProblemCode;
}

const LIMIT = 200; // characters (Unicode code points, as SQLite's length() counts them): title, payable id, label

/** Plain text for console fields (`lib/data/text.ts`), at most LIMIT code points. */
const plainText = (s: string, min: number, checkWellFormed = true) => isPlainText(s, min, LIMIT, checkWellFormed);

/** Console-only field rules, so the repository never surfaces a raw SQLite constraint error. */
function recordProblems(input: CreateBatchInput): BatchProblem[] {
  const problems: BatchProblem[] = [];
  if (!plainText(input.title, 1)) problems.push({ code: "title_invalid", detail: `title must be 1–${LIMIT} characters of plain text` });
  input.items.forEach((it, i) => {
    // Well-formedness of payable ids is preflight's rule (`payable_malformed`), so it is not reported twice.
    if (!plainText(it.payableId, 1, false)) problems.push({ code: "payable_id_invalid", itemIndex: i, detail: `payable id must be 1–${LIMIT} characters of plain text` });
    if (!plainText(it.label ?? "", 0)) problems.push({ code: "label_invalid", itemIndex: i, detail: `label must be at most ${LIMIT} characters of plain text` });
    // Slice H7: at creation only (preflight stays as it was, so a draft made earlier can still be paid). NUL is
    // preflight's own `memo_malformed` (ZIP 302), so it is not reported twice.
    if (!it.memo.includes("\u0000") && (hasInvisible(it.memo) || hasOtherSpace(it.memo))) problems.push({ code: "memo_invisible", itemIndex: i, detail: "memo must not contain invisible characters or any space but the ordinary one: it is the reference the recipient reads" });
  });
  return problems;
}

/** The batch would be refused by preflight's static rules or the console's field rules; nothing was written. */
export class BatchInvalidError extends ExecutionError {
  readonly problems: BatchProblem[];
  constructor(problems: BatchProblem[]) {
    super("batch_invalid", `batch is invalid: ${problems.map((p) => p.code).join(", ")}`);
    this.problems = problems;
  }
}

/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix milliseconds, version 7, variant 10, 74 random bits. Time-ordered
 * for index locality. `now` and `random` are injectable for tests.
 */
export function newBatchId(now: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) throw new RangeError(`timestamp ${now} out of range`);
  if (random.length !== 10) throw new RangeError("need 10 random bytes");
  const b = new Uint8Array(16);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(random, 6);
  b[6] = 0x70 | (b[6] & 0x0f); // version 7
  b[8] = 0x80 | (b[8] & 0x3f); // variant 10
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One nonce per batch (PayPal's `sender_batch_id` model): a changed batch is a new batch. */
export function batchNonce(rec: Pick<BatchRecord, "id">): string {
  return `batch/${rec.id}`;
}

export function toExecutionBatch(rec: BatchRecord): Batch {
  return { id: rec.id, network: rec.network, items: rec.items.map((i) => ({ payableId: i.payableId, address: i.address, zat: i.zat, memo: i.memo })) };
}

export function zatToDb(zat: bigint): number {
  const n = Number(zat);
  if (!Number.isSafeInteger(n) || BigInt(n) !== zat) throw new RangeError(`amount ${zat} is not exactly representable`);
  return n;
}

export interface CreateBatchInput {
  orgId: string;
  network: Network;
  title: string;
  items: BatchItemInput[];
}

export function createBatch(db: ConsoleDb, input: CreateBatchInput, opts: { maxRecipients?: number; now?: () => Date; newId?: () => string } = {}): Promise<BatchRecord> {
  if (!input.orgId) return Promise.reject(new RangeError("orgId is required"));
  const now = (opts.now ?? (() => new Date()))();
  const id = (opts.newId ?? (() => newBatchId(now.getTime())))();
  const candidate: Batch = { id, network: input.network, items: input.items.map((i) => ({ payableId: i.payableId, address: i.address, zat: i.zat, memo: i.memo })) };
  const problems: BatchProblem[] = [...batchProblems(candidate, { maxRecipients: opts.maxRecipients ?? 50 }), ...recordProblems(input)];
  if (problems.length) return Promise.reject(new BatchInvalidError(problems));
  const rec: BatchRecord = {
    orgId: input.orgId,
    id,
    network: input.network,
    title: input.title,
    createdAt: now.toISOString(),
    items: input.items.map((i, idx) => ({ idx, payableId: i.payableId, label: i.label ?? "", address: i.address, zat: i.zat, memo: i.memo })),
  };
  return runSync(() =>
    db.transaction(
      (tx) => {
        // Inside the write transaction (BEGIN IMMEDIATE serialises writers), so the answer names the holder; the
        // org-wide memo index and the 0018 trigger are the backstops whatever writes the database.
        const taken = acrossBatches(tx, rec.orgId, rec.items);
        if (taken.length) throw new BatchInvalidError(taken);
        tx.insert(batches).values({ orgId: rec.orgId, id: rec.id, network: rec.network, title: rec.title, createdAt: rec.createdAt, updatedAt: rec.createdAt }).run();
        for (const it of rec.items) {
          tx.insert(batchItems).values({ orgId: rec.orgId, batchId: rec.id, idx: it.idx, payableId: it.payableId, label: it.label, address: it.address, zat: zatToDb(it.zat), memo: it.memo }).run();
        }
        return rec;
      },
      { behavior: "immediate" },
    ),
  );
}

/** Lines of batches that are not voided: a voided batch holds no memo and no payable (slice H5c). */
export const liveLine = sql`not exists (select 1 from batch_voids v where v.org_id = ${batchItems.orgId} and v.batch_id = ${batchItems.batchId})`;

/**
 * A hand-made batch's lines against the rest of the org (review H5a round 1): a memo is a payable reference, unique
 * across the org's live batches (`memo_claims`, 0019, which replaced 0018's index), and a payable is paid only through a batch made from
 * payables (trigger `batch_items_manual_not_payable`), so one obligation cannot sit in two batches.
 */
function acrossBatches(db: Pick<ConsoleDb, "select">, orgId: string, items: { payableId: string; memo: string }[]): BatchProblem[] {
  const memos = [...new Set(items.map((i) => i.memo))];
  const ids = [...new Set(items.map((i) => i.payableId))];
  const heldBy = new Map(db.select({ memo: batchItems.memo, batchId: batchItems.batchId }).from(batchItems).where(and(eq(batchItems.orgId, orgId), inArray(batchItems.memo, memos), liveLine)).all().map((r) => [r.memo, r.batchId]));
  const owed = db.select({ id: payables.id, reference: payables.reference }).from(payables)
    .where(and(eq(payables.orgId, orgId), or(inArray(payables.id, ids), inArray(payables.reference, memos)))).all();
  const problems: BatchProblem[] = [];
  items.forEach((it, i) => {
    if (heldBy.has(it.memo)) problems.push({ code: "memo_taken", itemIndex: i, detail: `memo ${JSON.stringify(it.memo)} is already used by batch ${heldBy.get(it.memo)} (a memo is a payable reference, unique in the organisation)` });
    const p = owed.find((x) => x.id === it.payableId || x.reference === it.memo);
    if (p) problems.push({ code: "payable_reserved", itemIndex: i, detail: `this line is payable ${p.reference} (${p.id}); pay payables with a batch made from payables` });
  });
  return problems;
}

export function getBatch(db: ConsoleDb, orgId: string, id: string): Promise<BatchRecord | undefined> {
  return runSync(() => {
    const b = db.select().from(batches).where(and(eq(batches.orgId, orgId), eq(batches.id, id))).get();
    if (!b) return undefined;
    const items = db.select().from(batchItems).where(and(eq(batchItems.orgId, orgId), eq(batchItems.batchId, id))).orderBy(batchItems.idx).all();
    const voided = db.select({ at: batchVoids.voidedAt }).from(batchVoids).where(and(eq(batchVoids.orgId, orgId), eq(batchVoids.batchId, id))).get();
    return {
      orgId: b.orgId,
      id: b.id,
      network: b.network,
      title: b.title,
      createdAt: b.createdAt,
      items: items.map((i) => ({
        idx: i.idx, payableId: i.payableId, label: i.label, address: i.address, zat: BigInt(i.zat), memo: i.memo,
        // A line made from a payable (slice H5a) names it and keeps its cents; a hand-made line has neither.
        ...(i.payableRef !== null && i.usdCents !== null ? { payableRef: i.payableRef, usdCents: i.usdCents } : {}),
      })),
      ...(voided ? { voidedAt: voided.at } : {}),
    };
  });
}

/** Newest first by `created_at`, then id (UUIDv7 ids are time-ordered, so ties within a millisecond stay stable). */
export function listBatches(db: ConsoleDb, orgId: string): Promise<BatchSummary[]> {
  return runSync(() =>
    db
      .select({
        id: batches.id,
        network: batches.network,
        title: batches.title,
        createdAt: batches.createdAt,
        itemCount: sql<number>`count(${batchItems.idx})`,
        // Summed as SQLite's 64-bit integer and returned as text: a total can exceed 2^53 (50 items of 2.1e15).
        // The 64-bit sum itself overflows only above ~4,392 items of 2.1e15, far past maxRecipients.
        totalZat: sql<string>`cast(coalesce(sum(${batchItems.zat}), 0) as text)`,
        voided: sql<number>`exists (select 1 from batch_voids v where v.org_id = ${batches.orgId} and v.batch_id = ${batches.id})`,
      })
      .from(batches)
      .leftJoin(batchItems, and(eq(batchItems.orgId, batches.orgId), eq(batchItems.batchId, batches.id)))
      .where(eq(batches.orgId, orgId))
      .groupBy(batches.orgId, batches.id)
      .orderBy(desc(batches.createdAt), desc(batches.id))
      .all()
      .map((r) => ({ ...r, itemCount: Number(r.itemCount), totalZat: BigInt(r.totalZat), voided: Boolean(r.voided) })),
  );
}

/**
 * Whether a submission exists for the batch: from then on the batch and its items are frozen (triggers 0002)
 * and its rate can no longer be locked (0012). It looks the submission up by (org_id, batch_id), exactly as
 * those triggers do (review G1c1: the nonce lookup agreed for console submissions only). Shared by the
 * rate-lock API and the page.
 */
export function isSubmitted(db: ConsoleDb, rec: Pick<BatchRecord, "orgId" | "id">): Promise<boolean> {
  return runSync(() => db.select({ n: submissions.nonce }).from(submissions).where(and(eq(submissions.orgId, rec.orgId), eq(submissions.batchId, rec.id))).limit(1).get() !== undefined);
}

/**
 * Whether the batch's rate can no longer be locked: a submission exists that is not `failed_retryable` (the one
 * state proving nothing was paid). Mirrors the `rate_quotes_lock_frozen` trigger (migration 0014; review G2b1).
 */
export function rateLockFrozen(db: ConsoleDb, rec: Pick<BatchRecord, "orgId" | "id">): Promise<boolean> {
  return runSync(() => db.select({ n: submissions.nonce }).from(submissions).where(and(eq(submissions.orgId, rec.orgId), eq(submissions.batchId, rec.id), ne(submissions.state, "failed_retryable"))).limit(1).get() !== undefined);
}

/**
 * Whether the batch's rate is fixed (slice H5a): its lines were converted from payables at its lock, so a re-lock
 * would change the reported rate without changing the amounts (BTCPay's approved payout). The
 * `rate_quotes_fixed_for_payables` trigger (0017) is the backstop.
 */
export function rateFixed(rec: Pick<BatchRecord, "items">): boolean {
  return rec.items.some((i) => i.payableRef !== undefined);
}

/** A UUIDv7 for any console record (recipients too); `newBatchId` is its original name. */
export const newUuidV7 = newBatchId;
