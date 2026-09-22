// Console database schema (SQLite via better-sqlite3, Drizzle). `docs/product/05_data_model_api.md` §1.
// This slice holds the execution library's nonce store (`IdempotencyStore`); batches, items and
// receipts follow. Every table is scoped by `org_id`; the `orgs` table and its foreign keys arrive
// with the orgs slice.

import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

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

/**
 * (org, txid) → (nonce, attempt that recorded it). Never deleted, so a superseded txid still resolves.
 * Keyed per org like every other table: one org's record can never take over another org's entry.
 */
export const submissionTxids = sqliteTable(
  "submission_txids",
  {
    orgId: text("org_id").notNull(),
    txid: text("txid").notNull(),
    nonce: text("nonce").notNull(),
    attempt: integer("attempt").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.txid] }),
    foreignKey({ columns: [t.orgId, t.nonce], foreignColumns: [submissions.orgId, submissions.nonce] }),
    check("submission_txids_hex", sql`length(${t.txid}) = 64 and ${t.txid} not glob '*[^0-9a-f]*'`),
  ],
);

/** A payout batch: one transaction paying every item. Immutable once a submission exists (triggers, 0002). */
export const batches = sqliteTable(
  "batches",
  {
    orgId: text("org_id").notNull(),
    id: text("id").notNull(),
    network: text("network", { enum: ["main", "test", "regtest"] }).notNull(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    check("batches_id_uuid", sql`length(${t.id}) = 36 and ${t.id} glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`),
    check("batches_network", sql`${t.network} in ('main', 'test', 'regtest')`),
    check("batches_title_len", sql`length(${t.title}) between 1 and 200`),
  ],
);

/**
 * One output of a batch. Label and address are copied from the payee at creation so later payee edits never
 * rewrite what was paid; `payable_id` is the stable reference (PayPal's `sender_item_id`). Amounts are exact
 * integer zatoshi (≤ 2.1e15 < 2^53).
 */
export const batchItems = sqliteTable(
  "batch_items",
  {
    orgId: text("org_id").notNull(),
    batchId: text("batch_id").notNull(),
    idx: integer("idx").notNull(),
    payableId: text("payable_id").notNull(),
    label: text("label").notNull(),
    address: text("address").notNull(),
    zat: integer("zat").notNull(),
    memo: text("memo").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.batchId, t.idx] }),
    foreignKey({ columns: [t.orgId, t.batchId], foreignColumns: [batches.orgId, batches.id] }),
    unique("batch_items_payable_unique").on(t.orgId, t.batchId, t.payableId),
    unique("batch_items_memo_unique").on(t.orgId, t.batchId, t.memo),
    check("batch_items_idx", sql`${t.idx} >= 0`),
    check("batch_items_payable_len", sql`length(${t.payableId}) between 1 and 200`),
    check("batch_items_label_len", sql`length(${t.label}) <= 200`),
    check("batch_items_address", sql`length(${t.address}) between 1 and 1000 and ${t.address} = lower(${t.address})`),
    check("batch_items_zat", sql`typeof(${t.zat}) = 'integer' and ${t.zat} between 1 and 2100000000000000`),
    check("batch_items_memo_bytes", sql`length(cast(${t.memo} as blob)) between 1 and 512`),
  ],
);
