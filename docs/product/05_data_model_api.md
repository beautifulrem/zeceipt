# Data model, adapters, exports and contracts

## 1. Console data model (SQLite via libSQL, Drizzle)

Money: integer zatoshi (`bigint`) and integer USD cents. Rates: decimal string + source + ISO timestamp. All tables carry `created_at`, `updated_at`, and `org_id`.

| Table | Key fields | Invariants |
|---|---|---|
| `orgs` | id, name, network (main/test/regtest), custody_mode (hot/external), issuer_key_id, ufvk_encrypted | one active issuer key; UFVK encrypted at rest with an org wrap key |
| `members` | id, org_id, email, role (admin/approver/operator/viewer) | an org must have ≥ 2 members with role approver before any batch can leave `draft` |
| `recipients` | id, org_id, display_name, ua, network, kyc_status, tax_flag (us_1099/non_us/none), settlement_pref (zec/usdc_sol), notes | `ua` validated for `network`; duplicates flagged not blocked |
| `payables` | id, org_id, recipient_id, kind (milestone/invoice/bounty/salary), usd_cents, reference, source_ref (grant/issue link), status | reference is unique per org (becomes the memo) |
| `batches` | id, org_id, state, rate_zec_usd, rate_sources_json (≥ 1 entry: source name, quote, fetched_at; a second entry only once REQ-CON-20 (Should, cut item 4) is built), rate_locked_at, rate_at_execution, backend (zkool/zallet/zip321), txid, broadcast_at, confirmed_height, nonce | state machine below; `nonce` prevents double submission; preflight rejects `submitting` when `rate_at_execution` differs from `rate_zec_usd` by > 3% (REQ-CON-21) |
| `batch_items` | batch_id, payable_id, zat, output_index (nullable until confirmed), receipt_id (nullable) | `zat = floor(usd_cents × 10^8 / (100 × rate_zec_usd))` computed in integer/decimal arithmetic (never binary floats), floor so the payer never overpays by rounding; `rounding_dust_zat = exact − zat` stored; `sum(zat) + fee ≤ funded balance` checked at preflight |
| `approvals` | id, batch_id, member_id, hmac, approved_at | hmac = HMAC-SHA256(org secret, batch id ‖ sorted(recipient ua, zat) ‖ rate ‖ backend); invalid if batch content changes; execution requires 2 valid approvals from distinct approvers |
| `receipts` | id, org_id, batch_item_id, txid, pool, output_index, receipt_json, url, recovered_value_zat, recovered_recipient, memo_text, issued_at | unique (txid, pool, output_index); ock inside receipt_json is stored encrypted at rest |
| `issuer_keys` | id, org_id, key_id, pubkey_hex, secret_encrypted, valid_from, valid_to, revoked_at | drives `/.well-known/zeceipt.json` |
| (wrap key) | — | Encryption at rest (UFVK, OCKs in `receipts`, issuer secrets) uses an org wrap key derived from a deployment master key held in the process environment / secret store, never in the database; rotation re-wraps rows. In hot-custody mode the seed is only in the Zkool process; in external-signer mode no seed exists on the host (REQ-CON-17). |
| `audit_log` | id, org_id, actor, action, payload_hash, at | append-only |

Batch state machine: `draft → awaiting_approvals → approved → submitting → broadcast → confirming(n) → confirmed → receipts_issued`; failure edges: `submitting → failed_retryable`, `broadcast → unknown_outcome` (after timeout, manual reconcile), any → `cancelled` (only before broadcast).

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
| zkool-graphql (primary) | `mutation pay(idAccount, payment:{recipients:[{address, amount, memo}], srcPools, confirmations})` → txid; poll `transactionById` `[R18]` | seed lives only in the Zkool process; app holds UFVK; Docker image available |
| zallet-rpc | `z_sendmany` with duplicate-address splitting; poll `z_getoperationstatus/result`; treat lost reply after spawn as Unknown `[R19]` | beta; open spend-path bugs |
| zip321-manual | one ZIP-321 URI per recipient (never multi-recipient: Zodl rejects `[R17]`); operator scans with YWallet/Zodl; txid entered manually or detected via UFVK scan | non-custodial |

Receipt issuance is backend-independent: after `Mined{height}` and N confirmations, `zeceipt_core::issue` runs with the org OVK; results stored in `receipts`.

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
- Verification API (hosted, optional): `POST /v1/verify {receipt, raw_tx_hex?, challenge?}` → same JSON as the CLI; stateless, cacheable by (txid, index, ock hash).
- Solana attestation row (REQ-SOL-1): `zcash_txid[32] ‖ output_index u32 ‖ sha256(recovered recipient ‖ value ‖ memo) ‖ usd_cents u64 ‖ date u32 (days) ‖ key_id len+bytes`, signed by the issuer key; program verifies via the ed25519 precompile and stores at PDA `["receipt", txid, index]`.
