// Console database schema (SQLite via better-sqlite3, Drizzle). `docs/product/05_data_model_api.md` §1.
// This slice holds the execution library's nonce store (`IdempotencyStore`); batches, items and
// receipts follow. Every table is scoped by `org_id`; the `orgs` table and its foreign keys arrive
// with the orgs slice.

import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

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

/**
 * A payout batch: one transaction paying every item. Immutable once a submission exists (triggers in
 * migrations 0002 and 0003). The freeze is keyed by `(submissions.org_id, submissions.batch_id)`, so it holds
 * only if the nonce store's `orgId` equals this batch's `org_id` and the executed `Batch.id` equals `id`
 * (no foreign key on purpose: tools and the file store create submissions that belong to no console batch).
 */
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
 * integer zatoshi (≤ 2.1e15 < 2^53). A line made from a payable (slice H5a) also names it (`payable_ref`) and
 * keeps its USD cents; a payable is in at most one batch (the partial unique index), and triggers (0017) tie the
 * line's memo and cents to the payable and forbid changing them.
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
    payableRef: text("payable_ref"),
    usdCents: integer("usd_cents"),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.batchId, t.idx] }),
    // A memo's uniqueness across the org's live batches is `memo_claims` (slice H5c), which a void can release
    // without touching frozen lines; the 0017/0018 indexes it replaced are dropped in 0019.
    check("batch_items_payable_ref", sql`(${t.payableRef} is null) = (${t.usdCents} is null)`),
    check("batch_items_usd_cents", sql`${t.usdCents} is null or (typeof(${t.usdCents}) = 'integer' and ${t.usdCents} between 1 and 99999999)`),
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

/**
 * An issued receipt for one batch item. The receipt envelope (which contains the output's OCK) and its URL
 * are sealed together (`lib/crypto/seal.ts`, AAD = this row's identity); the other columns are plaintext
 * projections the org already holds. Immutable except for re-wrapping (`sealed`, `sealed_kid`), by trigger.
 */
export const receipts = sqliteTable(
  "receipts",
  {
    orgId: text("org_id").notNull(),
    txid: text("txid").notNull(),
    pool: text("pool", { enum: ["sapling", "orchard", "ironwood"] }).notNull(),
    outputIndex: integer("output_index").notNull(),
    batchId: text("batch_id").notNull(),
    idx: integer("idx").notNull(),
    valueZat: integer("value_zat").notNull(),
    recipient: text("recipient").notNull(),
    memoText: text("memo_text").notNull(),
    issuedAt: text("issued_at").notNull(),
    verifiedAt: text("verified_at").notNull(),
    sealed: text("sealed").notNull(),
    sealedKid: text("sealed_kid").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.txid, t.pool, t.outputIndex] }),
    unique("receipts_item_unique").on(t.orgId, t.batchId, t.idx),
    foreignKey({ columns: [t.orgId, t.batchId, t.idx], foreignColumns: [batchItems.orgId, batchItems.batchId, batchItems.idx] }),
    check("receipts_txid_hex", sql`length(${t.txid}) = 64 and ${t.txid} not glob '*[^0-9a-f]*'`),
    check("receipts_pool", sql`${t.pool} in ('sapling', 'orchard', 'ironwood')`),
    check("receipts_output_index", sql`typeof(${t.outputIndex}) = 'integer' and ${t.outputIndex} >= 0`),
    check("receipts_value", sql`typeof(${t.valueZat}) = 'integer' and ${t.valueZat} between 1 and 2100000000000000`),
    check("receipts_recipient", sql`length(${t.recipient}) between 1 and 1000`),
    check("receipts_sealed", sql`length(${t.sealed}) > 0 and length(${t.sealedKid}) between 1 and 64`),
  ],
);

// A decimal price as TEXT (slice G1b): digits first, only digits and at most one point, no trailing point.
// The app validates first (lib/rates/decimal.ts); this keeps raw SQL from storing `1e3` or `-5`.
const decimalCheck = (c: unknown) =>
  sql`typeof(${c}) = 'text' and length(${c}) between 1 and 34 and ${c} glob '[0-9]*' and ${c} not glob '*[^0-9.]*' and ${c} not glob '*.*.*' and ${c} not glob '*.'`;
const isoCheck = (c: unknown) =>
  sql`typeof(${c}) = 'text' and length(${c}) = 24 and ${c} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

/**
 * ZEC/USD quotes recorded for a batch (slice G1b; REQ-CON-4, NFR-8): an append-only history. `lock` quotes
 * convert and can be re-taken while the batch is a draft (the latest is current); an `execution` quote is taken
 * at submit (G2). Prices are exact decimal strings from the source; `rate` is the bid (G1a). Never updated,
 * deleted or replaced, and no lock once a submission froze the batch (triggers, migration 0012).
 */
export const rateQuotes = sqliteTable(
  "rate_quotes",
  {
    orgId: text("org_id").notNull(),
    batchId: text("batch_id").notNull(),
    seq: integer("seq").notNull(),
    purpose: text("purpose", { enum: ["lock", "execution"] }).notNull(),
    source: text("source").notNull(),
    pair: text("pair").notNull(),
    bid: text("bid").notNull(),
    ask: text("ask").notNull(),
    last: text("last").notNull(),
    rate: text("rate").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.batchId, t.seq] }),
    foreignKey({ columns: [t.orgId, t.batchId], foreignColumns: [batches.orgId, batches.id] }),
    check("rate_quotes_seq", sql`typeof(${t.seq}) = 'integer' and ${t.seq} >= 1`),
    check("rate_quotes_purpose", sql`${t.purpose} in ('lock', 'execution')`),
    check("rate_quotes_source", sql`${t.source} in ('kraken')`),
    check("rate_quotes_pair", sql`length(${t.pair}) between 1 and 32`),
    check("rate_quotes_bid", decimalCheck(t.bid)),
    check("rate_quotes_ask", decimalCheck(t.ask)),
    check("rate_quotes_last", decimalCheck(t.last)),
    check("rate_quotes_rate_is_bid", sql`${t.rate} = ${t.bid}`),
    check("rate_quotes_fetched_at", isoCheck(t.fetchedAt)),
    check("rate_quotes_recorded_at", isoCheck(t.recordedAt)),
  ],
);

/**
 * A payee the org pays (slice H1; REQ-CON-2; 05 `recipients`). A live record: batch items copy label and address at
 * creation, so a later change here never rewrites what was paid (B1, as ZBooks' payout lines do). The address is
 * a unified address of the recipient's network, stored lowercase. Duplicates are allowed and flagged on read
 * (05: "flagged not blocked"; a team wallet is legitimate). KYC and tax are recorded facts, never gates (FLOW-1).
 */
export const recipients = sqliteTable(
  "recipients",
  {
    orgId: text("org_id").notNull(),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    address: text("address").notNull(),
    network: text("network", { enum: ["main", "test", "regtest"] }).notNull(),
    kycStatus: text("kyc_status", { enum: ["unknown", "verified", "not_required"] }).notNull(),
    taxFlag: text("tax_flag", { enum: ["none", "us_1099", "non_us"] }).notNull(),
    settlementPref: text("settlement_pref", { enum: ["zec", "usdc_sol"] }).notNull(),
    notes: text("notes").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    index("recipients_address").on(t.orgId, t.address),
    check("recipients_id_uuid", sql`length(${t.id}) = 36 and ${t.id} glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`),
    check("recipients_name_len", sql`length(${t.displayName}) between 1 and 200`),
    check("recipients_network", sql`${t.network} in ('main', 'test', 'regtest')`),
    check("recipients_address", sql`length(${t.address}) between 1 and 1000 and ${t.address} = lower(${t.address}) and ((${t.network} = 'main' and ${t.address} glob 'u1*') or (${t.network} = 'test' and ${t.address} glob 'utest1*') or (${t.network} = 'regtest' and ${t.address} glob 'uregtest1*'))`),
    check("recipients_kyc", sql`${t.kycStatus} in ('unknown', 'verified', 'not_required')`),
    check("recipients_tax", sql`${t.taxFlag} in ('none', 'us_1099', 'non_us')`),
    check("recipients_settlement", sql`${t.settlementPref} in ('zec', 'usdc_sol')`),
    check("recipients_notes_len", sql`length(${t.notes}) <= 1000`),
  ],
);

/**
 * What the org owes (slice H3; REQ-CON-3; 05 `payables`): an amount in whole US cents owed to a recipient, with a
 * reference that becomes the payment's memo, so it is unique per org (a receipt binds one reference to one payable;
 * R78: stricter than Bill.com's invoice number, which is only a label). Immutable once written; its status (unpaid, in
 * a batch, paid) is derived from the batches that include it (H5), never stored. The source link can only be http(s),
 * so a page may render it as a link.
 */
export const payables = sqliteTable(
  "payables",
  {
    orgId: text("org_id").notNull(),
    id: text("id").notNull(),
    recipientId: text("recipient_id").notNull(),
    kind: text("kind", { enum: ["milestone", "invoice", "bounty", "salary"] }).notNull(),
    usdCents: integer("usd_cents").notNull(),
    reference: text("reference").notNull(),
    sourceUrl: text("source_url"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({ columns: [t.orgId, t.recipientId], foreignColumns: [recipients.orgId, recipients.id] }),
    unique("payables_reference_unique").on(t.orgId, t.reference),
    index("payables_recipient").on(t.orgId, t.recipientId),
    check("payables_id_uuid", sql`length(${t.id}) = 36 and ${t.id} glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`),
    check("payables_kind", sql`${t.kind} in ('milestone', 'invoice', 'bounty', 'salary')`),
    check("payables_usd_cents", sql`typeof(${t.usdCents}) = 'integer' and ${t.usdCents} between 1 and 99999999`),
    check("payables_reference", sql`typeof(${t.reference}) = 'text' and length(${t.reference}) between 1 and 100 and ${t.reference} = trim(${t.reference})`),
    check("payables_source_url", sql`${t.sourceUrl} is null or (typeof(${t.sourceUrl}) = 'text' and length(${t.sourceUrl}) <= 2000 and (${t.sourceUrl} glob 'https://?*' or ${t.sourceUrl} glob 'http://?*'))`),
    check("payables_created_at", isoCheck(t.createdAt)),
  ],
);

/**
 * A voided draft (slice H5c; R82): final and kept, as Stripe voids an invoice and BTCPay cancels a payout. Allowed
 * only while nothing may have been sent (no submission, or only `failed_retryable`); afterwards the batch can take no
 * submission, retry, quote or receipt (triggers, 0019). Append-only.
 */
export const batchVoids = sqliteTable(
  "batch_voids",
  {
    orgId: text("org_id").notNull(),
    batchId: text("batch_id").notNull(),
    voidedAt: text("voided_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.batchId] }),
    foreignKey({ columns: [t.orgId, t.batchId], foreignColumns: [batches.orgId, batches.id] }),
    check("batch_voids_voided_at", isoCheck(t.voidedAt)),
  ],
);

/**
 * The live claim on a memo (slice H5c): one per (org, memo), inserted by a trigger with every batch line, deleted only
 * when its batch is voided. A memo is a payable reference, so this is also each payable's claim (a payable line's memo
 * is its reference, 0017). It replaces 0018's index on batch_items, which a void could not release.
 */
export const memoClaims = sqliteTable(
  "memo_claims",
  {
    orgId: text("org_id").notNull(),
    memo: text("memo").notNull(),
    batchId: text("batch_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.memo] }),
    foreignKey({ columns: [t.orgId, t.batchId], foreignColumns: [batches.orgId, batches.id] }),
    index("memo_claims_batch").on(t.orgId, t.batchId),
  ],
);
