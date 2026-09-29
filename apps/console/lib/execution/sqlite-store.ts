// `IdempotencyStore` on SQLite (better-sqlite3 + Drizzle).
// Every write is one synchronous `BEGIN IMMEDIATE` transaction, so compare-and-set, claims and the txid
// index are atomic and cross-process safe without any lease (unlike the file store, RSK-21 clause c).
// Being synchronous, a write cannot interleave with another write in the same process.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { submissionClaims, submissions, submissionTxids } from "../../db/schema.ts";
import { runSync as sync } from "../../db/errors.ts";
import type { Expect, IdempotencyStore, SubmissionRecord, TxidEntry } from "./idempotency.ts";

type Row = typeof submissions.$inferSelect;

function toRecord(r: Row): SubmissionRecord {
  const rec: SubmissionRecord = { nonce: r.nonce, batchId: r.batchId, batchDigest: r.batchDigest, state: r.state, createdAt: r.createdAt, attempts: r.attempts };
  if (r.txid !== null) rec.txid = r.txid;
  if (r.intentHeight !== null) rec.intentHeight = r.intentHeight;
  if (r.expiresBy !== null) rec.expiresBy = r.expiresBy;
  if (r.broadcastAt !== null) rec.broadcastAt = r.broadcastAt;
  if (r.error !== null) rec.error = r.error;
  return rec;
}

function toColumns(rec: SubmissionRecord) {
  return {
    batchId: rec.batchId,
    batchDigest: rec.batchDigest,
    state: rec.state,
    attempts: rec.attempts,
    txid: rec.txid ?? null,
    intentHeight: rec.intentHeight ?? null,
    expiresBy: rec.expiresBy ?? null,
    createdAt: rec.createdAt,
    broadcastAt: rec.broadcastAt ?? null,
    error: rec.error ?? null,
  };
}

export class SqliteIdempotencyStore implements IdempotencyStore {
  private readonly db: ConsoleDb;
  private readonly orgId: string;
  private readonly clock: () => number;

  constructor(db: ConsoleDb, opts: { orgId: string; clock?: () => number }) {
    if (!opts.orgId) throw new RangeError("orgId is required");
    this.db = db;
    this.orgId = opts.orgId;
    this.clock = opts.clock ?? Date.now;
  }

  private key(nonce: string) {
    return and(eq(submissions.orgId, this.orgId), eq(submissions.nonce, nonce));
  }

  private nowIso() {
    return new Date(this.clock()).toISOString();
  }

  private read(nonce: string): SubmissionRecord | undefined {
    const row = this.db.select().from(submissions).where(this.key(nonce)).get();
    return row && toRecord(row);
  }

  createIntent(rec: SubmissionRecord) {
    return sync(() =>
      this.db.transaction(
        (tx) => {
          const r = tx.insert(submissions).values({ orgId: this.orgId, nonce: rec.nonce, ...toColumns(rec), updatedAt: this.nowIso() }).onConflictDoNothing().run();
          if (r.changes === 1) return { created: true as const };
          const existing = this.read(rec.nonce);
          if (!existing) throw new Error(`nonce ${rec.nonce} conflicted but no record exists`);
          return { created: false as const, existing };
        },
        { behavior: "immediate" },
      ),
    );
  }

  get(nonce: string) {
    return sync(() => this.read(nonce));
  }

  update(next: SubmissionRecord, expect: Expect) {
    if (expect.states.length === 0) return Promise.resolve(false);
    return sync(() =>
      this.db.transaction(
        (tx) => {
          const r = tx
            .update(submissions)
            .set({ ...toColumns(next), updatedAt: this.nowIso() })
            .where(
              and(
                this.key(next.nonce),
                eq(submissions.attempts, expect.attempts),
                inArray(submissions.state, expect.states),
                expect.expiresBy === undefined ? sql`1` : expect.expiresBy === null ? isNull(submissions.expiresBy) : eq(submissions.expiresBy, expect.expiresBy),
              ),
            )
            .run();
          if (r.changes !== 1) return false;
          if (next.txid) {
            tx.insert(submissionTxids)
              .values({ txid: next.txid, orgId: this.orgId, nonce: next.nonce, attempt: next.attempts })
              // First record wins: an index entry never moves (and the `submission_txids_keep` trigger enforces it).
              .onConflictDoNothing()
              .run();
          }
          return true;
        },
        { behavior: "immediate" },
      ),
    );
  }

  findByTxid(txid: string): Promise<TxidEntry | undefined> {
    if (!/^[0-9a-f]{64}$/.test(txid)) return Promise.resolve(undefined);
    return sync(() => {
      const row = this.db
        .select({ s: submissions, attempt: submissionTxids.attempt })
        .from(submissionTxids)
        .innerJoin(submissions, and(eq(submissions.orgId, submissionTxids.orgId), eq(submissions.nonce, submissionTxids.nonce)))
        .where(and(eq(submissionTxids.txid, txid), eq(submissionTxids.orgId, this.orgId)))
        .get();
      return row && { record: toRecord(row.s), attempt: row.attempt };
    });
  }

  claimAttempt(nonce: string, attempt: number, reclaimAfterMs: number) {
    return sync(() =>
      this.db.transaction(
        (tx) => {
          const where = and(eq(submissionClaims.orgId, this.orgId), eq(submissionClaims.nonce, nonce), eq(submissionClaims.attempt, attempt));
          const last = tx.select().from(submissionClaims).where(where).orderBy(desc(submissionClaims.gen)).limit(1).get();
          const now = this.clock();
          if (last && now - last.claimedAtMs <= reclaimAfterMs) return false; // a live claim: someone else is on it
          const r = tx.insert(submissionClaims).values({ orgId: this.orgId, nonce, attempt, gen: last ? last.gen + 1 : 0, claimedAtMs: now }).onConflictDoNothing().run();
          return r.changes === 1;
        },
        { behavior: "immediate" },
      ),
    );
  }
}
