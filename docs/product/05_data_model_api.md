# Data model, adapters, exports and contracts

## 1. Console data model (SQLite via better-sqlite3, Drizzle)

Storage is one SQLite file per deployment. Writes are synchronous `BEGIN IMMEDIATE` transactions; the file runs in WAL mode with `synchronous = FULL` and foreign keys on. libSQL's local client was rejected after a reproduced durability defect: after a busy error, later writes are silently not committed `[R47]`. Integrity is enforced by the schema itself (composite keys, CHECKs, conditional updates, triggers), never by check-then-insert or in-process locks, which are the competitor mistakes in `[R46]`. The execution ledger is protected by triggers (REQ-CON-7). A submission is never deleted, and its identity (org, nonce, batch, digest) never changes; its state, txid, attempts and bounds change only through the store's compare-and-set. The txid index is insert-only: never updated, never deleted, first entry wins. `INSERT OR REPLACE` of an existing ledger row or index entry is a no-op, and a batch is frozen once a submission exists for it.

Money: integer zatoshi (`bigint`) and integer USD cents. Rates: decimal string + source + ISO timestamp. All tables carry `org_id`. All tables carry `created_at` and `updated_at` except three: the two append-only ledger tables `submission_claims` (which carries `claimed_at_ms`) and `submission_txids`, and `batch_items`, which inherits its batch's timestamps (items are written once, with the batch).

| Table | Key fields | Invariants |
|---|---|---|
| `orgs` | id, name, network (main/test/regtest), custody_mode (hot/external), issuer_key_id, ufvk_encrypted | one active issuer key; UFVK encrypted at rest with an org wrap key |
| `members` | id, org_id, email, role (admin/approver/operator/viewer) | an org must have ≥ 2 members with role approver before any batch can leave `draft` |
| `recipients` | id, org_id, display_name, ua, network, kyc_status, tax_flag (us_1099/non_us/none), settlement_pref (zec/usdc_sol), notes | `ua` validated for `network`; duplicates flagged not blocked |
| `payables` | id, org_id, recipient_id, kind (milestone/invoice/bounty/salary), usd_cents, reference, source_ref (grant/issue link), status | reference is unique per org (becomes the memo); REQ-CON-3 |
| `batches` | built (slice B1): (org_id, id) PK with id a UUIDv7 `[R49]`, network, title, created_at, updated_at; frozen by triggers once a `submissions` row exists for it; one nonce per batch, `batch/<id>`, as PayPal's `sender_batch_id` `[R48]` (REQ-CON-7). The freeze is keyed by `(submissions.org_id, submissions.batch_id)`; it therefore requires the nonce store's `orgId` to equal the batch's `org_id` and the executed `Batch.id` to equal `batches.id` (there is deliberately no foreign key, because tools and the file store create submissions that belong to no console batch). `submissions` rows are never deleted and their identity never changes (triggers). Planned: rate_zec_usd, rate_sources_json (≥ 1 entry: source name, quote, fetched_at; a second entry only once REQ-CON-20 (Should, cut item 4) is built), rate_locked_at, rate_at_execution, backend (zkool/zallet/zip321). No stored state, txid, broadcast_at, confirmed_height or nonce: the nonce is `batch/<id>`, the txid and times live in `submissions`, and the state is derived (below) | the status is derived (below); the nonce prevents double submission; preflight rejects submitting when `rate_at_execution` differs from `rate_zec_usd` by > 3% (REQ-CON-21) |
| `batch_items` | built (slice B1): (org_id, batch_id, idx) PK, payable_id, label and address copied from the payee, zat INTEGER (1 ≤ zat ≤ 2.1×10¹⁵, exact below 2⁵³), memo (1–512 UTF-8 bytes); UNIQUE payable and memo per batch; frozen with the batch (REQ-CON-3). Planned: output_index (nullable until confirmed), receipt_id (nullable) | `zat = floor(usd_cents × 10^8 / (100 × rate_zec_usd))` computed in integer/decimal arithmetic (never binary floats), floor so the payer never overpays by rounding; `rounding_dust_zat = exact − zat` stored; `sum(zat) + fee ≤ funded balance` checked at preflight |
| `approvals` | id, batch_id, member_id, hmac, approved_at | hmac = HMAC-SHA256(org secret, batch id ‖ sorted(recipient ua, zat) ‖ rate ‖ backend); invalid if batch content changes; execution requires 2 valid approvals from distinct approvers |
| `receipts` | built (slice B2): (org_id, txid, pool, output_index) PK; batch_id, idx (UNIQUE per org, FK to `batch_items`); value_zat, recipient, memo_text, issued_at, verified_at in plaintext; `sealed` = the receipt envelope and URL (they contain the output's OCK) sealed with AES-256-GCM under the org key, with the row identity as AAD `[R51]` `[R52]`; `sealed_kid` | one receipt per item, first per output wins; recorded only for the batch's own broadcast txid; never deleted; only `sealed`/`sealed_kid` may change (re-wrap) (REQ-CON-11) |
| `issuer_keys` | id, org_id, key_id, pubkey_hex, secret_encrypted, valid_from, valid_to, revoked_at | drives `/.well-known/zeceipt.json` |
| (wrap key) | — | Encryption at rest (UFVK, OCKs in `receipts`, issuer secrets) uses an org wrap key derived from a deployment master key held in the process environment / secret store, never in the database: HKDF-SHA256 with salt `zeceipt/wrap/v1` and info `org:<id>` `[R53]`, per key id; the keyring's last key seals and every listed key opens `[R50]`; rotation re-wraps rows (`rewrapReceipts`, built for receipts). In hot-custody mode the seed is only in the Zkool process; in external-signer mode no seed exists on the host (REQ-CON-17). |
| `audit_log` | id, org_id, actor, action, payload_hash, at | append-only |
| `submissions` (built) | (org_id, nonce) PK, batch_id, batch_digest, state, attempts, txid, intent_height, expires_by, created_at, updated_at, broadcast_at, error | the execution nonce record (`IdempotencyStore`, §2): CHECKs on state, hex digest/txid, attempts ≥ 1, and `broadcast` ⇒ txid; never pruned, because it is the payment-attempt ledger, unlike Stripe's 24 h idempotency keys `[R45]`; REQ-CON-7 |
| `submission_claims` (built) | (org_id, nonce, attempt, gen) PK, claimed_at_ms | exclusive, recoverable retry claims; FK to `submissions`; REQ-CON-7 |
| `submission_txids` (built) | (org_id, txid) PK, nonce, attempt | (org, txid) → the attempt that recorded it; never deleted; written in the same transaction as the record; REQ-CON-7 |

Batch status is derived, never stored (built, slice B3: `lib/data/status.ts`, table in `.trellis/tasks/09-23-batch-status/design.md` §3.3.1.3.4.2). It is computed from the submission record, the chain status and the receipt count, so it cannot drift from them. The states are `draft`, `submitting`, `retryable`, `needs_attention`, `pending`, `confirming(n of N)`, `confirmed`, `receipts_partial`, `receipts_issued` and `expired`, each with a next action (`submit`, `wait`, `issue_receipts`, `resend_expired`, `record_expiry`, `investigate`, `none`). The reader uses the execution backend's own nonce store and in-flight window, so the status never disagrees with what `submit` will do. It fails closed: only a mined transaction with N confirmations counts as confirmed. The names follow Stripe's PaymentIntent lifecycle `[R54]` and PayPal's batch/item statuses `[R48]` (REQ-CON-7, REQ-CON-11). Approval states (`awaiting_approvals`, `approved`) and `cancelled` arrive with the approvals slice.

## 2. Execution-backend adapter contract

```
trait PayoutBackend {
  fn name(&self) -> &'static str;                       // "zkool-graphql" | "zallet-rpc" | "zip321-manual"
  async fn preflight(&self, batch) -> Result<Preflight>; // balance, address validity, memo length ≤ 512 bytes
  async fn submit(&self, batch, nonce) -> Result<Submitted { txid | uris: Vec<String> }>;
  async fn status(&self, txid) -> Result<TxStatus { Pending | Mined{height} | Unknown }>;
}
```

| Backend | Mechanism | Notes |
|---|---|---|
| zkool-graphql (primary) | `mutation pay(idAccount, payment:{recipients:[{address, amount, memo}], srcPools, confirmations})` → txid; poll `transactionsByAccount(idAccount, height)` for `height > 0` `[R18]`. Measured on regtest 2026-09-22 (PROOF §5b): run `zkool_graphql --coin 2 --lwd-url <zaino> --no-mempool`; pool bits transparent 1 / sapling 2 / orchard 4 / **ironwood 8**; amounts are decimal strings in ZEC; memo > 512 bytes rejected before signing; 3 recipients + change land in one v6 tx; restore the issuer with `useInternal: true` or notes at the internal scope are invisible | seed lives only in the Zkool process; app holds UFVK; built from source on this machine (no Docker), Docker image also available |
| zallet-rpc | `z_sendmany` with duplicate-address splitting; poll `z_getoperationstatus/result`; treat lost reply after spawn as Unknown `[R19]` | beta; open spend-path bugs |
| zip321-manual | one ZIP-321 URI per recipient (never multi-recipient: Zodl rejects `[R17]`); operator scans with YWallet/Zodl; txid entered manually or detected via UFVK scan | non-custodial |

Implemented in TypeScript as `apps/console/lib/execution/` (`PayoutBackend`, `ZkoolBackend`; stores `SqliteIdempotencyStore` for the console and `FileIdempotencyStore` for tools, both passing one contract suite; PROOF §5c). Zkool behaviours relied on are in `[R44]`; preflight's fee estimate follows ZIP 317 and its address checks ZIP 316 `[R43]`. Idempotency: an intent record is created exclusively per nonce *before* `pay`; a replay returns the recorded txid; only a known pre-build refusal from Zkool (e.g. "No feasible note selection found", "Not enough funds") leaves the nonce `failed_retryable` (retry claims the next attempt exclusively). Every other failure (transport loss, timeout, any other GraphQL error — Zkool reports a failed gRPC send that way even when the node may already hold the transaction — or a node rejection returned in place of a txid) leaves it `unknown_outcome` with `expiresBy` = node tip after the attempt + 40 (Zkool's expiry delta; a transaction cannot be mined above its expiry height) + a 10-block reorg margin. A later submit reconciles against the issuer's mined transactions by address + memo + value, up to the account's *scanned* height (Zkool's `synchronizeAccount` can return the node tip without scanning). Found → adopt the txid; not found and scanned height > `expiresBy` → the attempt can never be mined, so pay again under the same nonce; otherwise still unknown. Record writes are compare-and-set per attempt; retry claims are recoverable after `inFlightMs`, so a crash cannot wedge a nonce. An expired `broadcast` is re-sent only by the explicit `resubmitExpired` (residual assumption: RSK-21). `autoIssue` matches each receipt to its own item (memo, value, address via the CLI's `matched_only_to`, not change, no output claimed twice) and writes receipt files only after every receipt verified.

Receipt issuance is backend-independent (REQ-CON-11): after `Mined{height}` and N confirmations, `autoIssue` (`apps/console/lib/issuance/auto-issue.ts`) runs `zeceipt issue --only-to <each batch address> --ufvk-file …` (the allow-list is matched by shielded receiver in `zeceipt-core`), cross-checks one receipt per batch item (memo, value, payee address via the CLI's `matched_only_to`, never change, no output claimed twice), verifies each, and only then writes the files and returns; results will be stored in `receipts`.

## 3. Export formats (exact columns)

### 3.1 OpenZcash-compatible (`openzcash.csv`) `[R5]`
`recipient,detail,category,usd,zec,rate,date,status,txid,receipt_url`
- `usd` = budgeted USD (2 dp); `zec` = disbursed ZEC (8 dp); `rate` = locked ZEC/USD; `date` = ISO date of confirmation; `status` ∈ {paid, open, cancelled}.
- First eight columns match OpenZcash's row model; the last two are additive.

### 3.2 QuickBooks Online 3-column (`qbo.csv`) `[R32]`
`Date,Description,Amount`
- `Date` `MM/DD/YYYY`; `Description` = `reference — recipient display name`; `Amount` negative for money out, plain decimal, no currency symbols or thousands separators; header row only; file split when a chunk approaches the ~350 KB upload limit recorded in `[R32]` (≈ 5,000 short rows; inference from the size limit, not a documented row cap). (4-column variant `Date,Description,Credit,Debit` available as an option.)

### 3.3 Xero bank statement (`xero.csv`) `[R32]`
`Date,Amount,Payee,Description,Reference`
- Single signed `Amount` column (negative = paid out); `Date` in the organisation's regional format (default `MM/DD/YYYY` for US); UTF-8; ≤ 100,000 rows; `Reference` = payable reference (memo).

### 3.4 1099-NEC preparation (`1099_totals.csv`) `[R25]` `[R26]`
`recipient,tax_flag,calendar_year,total_usd,payment_count,first_payment,last_payment,threshold_reached`
- `total_usd` = sum of FMV at payment (locked rate at execution, source recorded); `threshold_reached` = total ≥ $2,000 for payments from 2026-01-01 (configurable for states that keep $600).
- The product does not file forms; it produces the totals and per-payment evidence (receipt links).

### 3.5 Receipt bundle (`receipts.json`)
Array of receipt envelopes (spec §2). Public feed for ledgers (FLOW-5).

## 4. Contracts

- Receipt envelope v0: `spec/receipt-v0.md` §2 (JSON), §5 (signing), URL form `/r/<base64url(json)>`.
- Audit pack: `{"version":"zeceipt-v0","title","declared_total_zat","receipts":[…]}` (spec §8).
- Well-known issuer keys (`/.well-known/zeceipt.json`, REQ-INT-3 — Should, planned for leaf 3.3.3.3, dropped in the solo branch):
```json
{ "version": "zeceipt-v0", "org": "Example DAO", "root_pubkey": "<hex>",
  "keys": [ {"key_id": "2026-09", "pubkey": "<hex>", "valid_from": "2026-09-01", "valid_to": null, "revoked_at": null} ],
  "signature": "<hex ed25519 by root over canonical JSON of keys>" }
```
Verifier semantics: signature validity from the inline key; binding lookup can only upgrade to "confirmed"; unknown/lapsed → "issuer binding unknown".
- Console batch routes (built, slice D1; `docs/api/openapi.json`): `POST /api/batches` creates a draft from `{title, items:[{payableId, label?, address, zat, memo}]}` → 201 with `Location` (the org and network come from the deployment's config; unknown keys are refused); `GET /api/batches` (newest first, `totalZat`); `GET /api/batches/{id}`. Amounts are zatoshi as decimal strings both ways (totals can exceed 2^53). Errors are RFC 9457 `application/problem+json` with a `code` (`batch_invalid` carries every problem with its item index) `[R58]`. Every request needs a loopback `Host`; unsafe methods refuse cross-site `Sec-Fetch-Site` and a foreign `Origin` (pages: `proxy.ts`; API routes: `guarded()`, which keeps the live body stream so an oversize body gets 413 at once) `[R59]` `[R60]`.
- Console submit and status (built, slice D2): `POST /api/batches/{id}/submit` with `{confirmTotalZat}` (must equal the batch total) pays once per batch nonce and answers 202 `{batchId, txid, replayed, via, status}` with `Location` pointing to the status route; a replay carries `Idempotent-Replayed: true`. `GET /api/batches/{id}/status` → `{batchId, state, next, detail}` (§1 derived status). Execution problems carry `payment` (`not_sent` | `unknown`): `preflight_failed` 422, `payment_rejected` 409, `outcome_unknown` 502, `submission_in_flight` 409 + `Retry-After`, `nonce_conflict` 409, `store_busy` 503 + `Retry-After`, `wallet_unavailable` 502, `custody_external` 409, `confirmation_mismatch` 422 `[R61]`.
- Console health (built, slice C2): `GET /api/health` → `application/health+json`, `{"status":"pass","checks":{"sqlite:responsiveness":[{"status":"pass"}]}}` with 200, or `fail` with 503; `Cache-Control: no-store`; no version, path, org or dependency details `[R57]`.
- Verification API (hosted, optional): `POST /v1/verify {receipt, raw_tx_hex?, challenge?}` → same JSON as the CLI; stateless, cacheable by (txid, index, ock hash).
- Solana attestation row (REQ-SOL-1): `zcash_txid[32] ‖ output_index u32 ‖ sha256(recovered recipient ‖ value ‖ memo) ‖ usd_cents u64 ‖ date u32 (days) ‖ key_id len+bytes`, signed by the issuer key; program verifies via the ed25519 precompile and stores at PDA `["receipt", txid, index]`.
