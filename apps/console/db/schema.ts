// Console database schema (SQLite via better-sqlite3, Drizzle). `docs/product/05_data_model_api.md` §1.
// This slice holds the execution library's nonce store (`IdempotencyStore`); batches, items and
// receipts follow. Every table is scoped by `org_id`; the `orgs` table and its foreign keys arrive
// with the orgs slice.

import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One row per (org, nonce): the payment-attempt ledger of a batch. Never pruned (design 3.3.1.3.1.1.3). */
export const submissions = sqliteTable(
  "submissions",
  {
    orgId: text("org_id").notNull(),
    nonce: text("nonce").notNull(),
    batchId: text("batch_id").notNull(),
    batchDigest: text("batch_digest").notNull(),
    state: text("state", { enum: ["submitting", "broadcast", "failed_retryable", "unknown_outcome"] }).notNull(),
    attempts: integer("attempts").notNull(),
    txid: text("txid"),
    intentHeight: integer("intent_height"),
    expiresBy: integer("expires_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    broadcastAt: text("broadcast_at"),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.nonce] }),
    check("submissions_nonce_len", sql`length(${t.nonce}) between 1 and 200`),
    check("submissions_digest_hex", sql`length(${t.batchDigest}) = 64 and ${t.batchDigest} not glob '*[^0-9a-f]*'`),
    check("submissions_state", sql`${t.state} in ('submitting', 'broadcast', 'failed_retryable', 'unknown_outcome')`),
    check("submissions_attempts", sql`${t.attempts} >= 1`),
    check("submissions_txid_hex", sql`${t.txid} is null or (length(${t.txid}) = 64 and ${t.txid} not glob '*[^0-9a-f]*')`),
    check("submissions_broadcast_has_txid", sql`${t.state} <> 'broadcast' or ${t.txid} is not null`),
  ],
);

/** Retry-attempt claims as exclusive generations (see `IdempotencyStore.claimAttempt`). */
export const submissionClaims = sqliteTable(
  "submission_claims",
  {
    orgId: text("org_id").notNull(),
    nonce: text("nonce").notNull(),
    attempt: integer("attempt").notNull(),
    gen: integer("gen").notNull(),
    claimedAtMs: integer("claimed_at_ms").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.nonce, t.attempt, t.gen] }),
    foreignKey({ columns: [t.orgId, t.nonce], foreignColumns: [submissions.orgId, submissions.nonce] }),
    check("submission_claims_attempt", sql`${t.attempt} >= 2 and ${t.gen} >= 0`),
  ],
);

/** txid → (nonce, attempt that recorded it). Never deleted, so a superseded txid still resolves. */
export const submissionTxids = sqliteTable(
  "submission_txids",
  {
    txid: text("txid").primaryKey(),
    orgId: text("org_id").notNull(),
    nonce: text("nonce").notNull(),
    attempt: integer("attempt").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.nonce], foreignColumns: [submissions.orgId, submissions.nonce] }),
    check("submission_txids_hex", sql`length(${t.txid}) = 64 and ${t.txid} not glob '*[^0-9a-f]*'`),
  ],
);
