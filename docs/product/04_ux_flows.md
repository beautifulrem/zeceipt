# UX flows, screens and copy

## 1. Design principles

1. Three-part outcome, never a single boolean: cryptographic validity · chain inclusion (confirmations) · issuer binding (confirmed / unknown / unsigned).
2. Proves / does-not-prove text is always visible next to a result (spec §4).
3. The receipt page needs no login and no server: verification runs in the browser; the page says which node it asks for the txid.
4. Money is shown as ZEC with 8 decimals and USD at the locked rate with its source and timestamp; never floats.
5. English only (hackathon rule `[R1]`).

## 2. Flows

### FLOW-1 Issuer runs a batch (P1/P2)
1. Import CSV (Konclave `label,address,value[,memo]` or zecpay `name,wallet,amount,currency,payout_currency`) or add payables by hand → validation report (bad UA, duplicate address, missing KYC on ≥ $2,000 aggregate `[R26]`).
2. Create batch → lock rate (two sources shown with deviation; > 3% blocks).
3. Approvals: two approvers each see recipients, totals, rate; approve → HMAC recorded; any edit resets approvals.
4. Execute: choose backend (Zkool hot-custody · external signer via per-recipient ZIP-321 QR); confirm dialog restates totals.
5. Track: pending → broadcast → confirmed(n); failure rows retryable, no duplicates.
6. Receipts issued automatically; links copied or emailed; export CSVs (OpenZcash / QBO / Xero).
Error states: rate source down (use the other, mark), backend unreachable (batch stays approved), tx not found after 30 min (mark "unknown outcome", require manual reconcile), recipient address on the wrong network (blocked at import).

### FLOW-2 Recipient verifies (P3)
1. Opens `https://<host>/r/<payload>` (or pastes a receipt into the demo page).
2. Page loads wasm, shows "what this proves" before fetching anything.
3. Fetch raw tx from a public node (button; explains the txid is revealed to that node) or load a file.
4. Result: VALID with recipient/value/memo/label/issuer/challenge state; INVALID with the failing stage in plain words.
5. Optional: download JSON/PDF; if a challenge was issued to them, enter it.

### FLOW-3 Auditor verifies a pack (P4)
1. Receives `pack.json` (and optionally a challenge they issued).
2. `zeceipt verify-pack pack.json [--raw-tx-dir …] [--challenge …]` or the pack page.
3. Sees per-row outcome and `verified_total_zat` with the lower-bound sentence.
4. Exports the verified rows to their accounting format.

### FLOW-4 Integrator (P5)
1. `cargo add zeceipt-core` or `npm i @zeceipt/verify`.
2. Issue: `issue(tx, keys, opts)` after broadcast → receipts; or `zeceipt issue` in CI.
3. Verify: `verifyReceipt(json, rawTxHex, {challenge, requireSignature})` → typed result with stage.
4. Vectors: `spec/test-vectors/receipt-v0.json` to test their own encoder.

### FLOW-5 Public ledger (P6)
1. Organisation publishes `receipts.json` (array of receipts) at a stable URL.
2. Ledger site verifies rows (browser or batch) and shows a "verified" badge with a self-verify link.
3. Rows without receipts stay grey.

## 3. Screen inventory (console)

| ID | Screen | States |
|---|---|---|
| SCR-1 | Org dashboard | empty, batches by state, receipts issued count |
| SCR-2 | Recipients | list, add/edit, validation errors, KYC/tax flags, linkability warning |
| SCR-3 | Payables | import (report with row errors), list, filters by type/status |
| SCR-4 | Batch detail | draft / awaiting approvals / approved / executing / confirmed / failed rows; rate panel; approval log |
| SCR-5 | Execute dialog | backend choice, custody-mode notice, restated totals, confirm |
| SCR-6 | Receipts | per batch: links, copy, resend; issuance status |
| SCR-7 | Audit packs | build, download, share link |
| SCR-8 | Exports | OpenZcash / QuickBooks / Xero / 1099 totals; column preview |
| SCR-9 | Settings | members & roles, issuer keys (key id, rotation), well-known file, endpoints |
| SCR-10 | Public receipt page | loading wasm · fetching · valid · invalid(stage) · pending |
| SCR-11 | Public pack page | per-row results, total, lower-bound note |

## 4. Error taxonomy → user copy

| Stage | Copy (verifier) |
|---|---|
| parse | "This is not a Zeceipt receipt (or it is for a newer format)." |
| tx | "The transaction data could not be read." |
| txid | "This receipt is for a different transaction than the one provided." |
| signature | "The issuer signature does not match — the receipt was altered after signing, or it was not signed by the stated key." |
| challenge | "The challenge you entered does not match the one bound into this receipt." |
| output | "The receipt points at an output that does not exist in this transaction." |
| recovery | "The disclosed key does not open this output — the receipt is not valid for this payment." |
| network | "This receipt is for a different network than the one you selected." |
| pending | "The transaction was not found yet. It may be unconfirmed — try again later." |

## 5. Product-form observations from live products (Chrome, 2026-09-22) `[R35]`

- **Konclave** landing: "COLLECTIVE ZCASH TREASURY · FROST — The vault your group opens together… Private outside, transparent inside." Calls to action: Create a vault · Download the app; trust bullets: local-first, no telemetry, real ZEC proven on mainnet with verifiable txids, open source. Note: its tagline is one word away from ours ("provable per payment" vs "transparent inside"); we keep ours because it names the artefact, but the pitch must position Zeceipt as the proof layer *for* vaults like Konclave, not as a rival vault.
- **OpenZcash disbursements**: columns Recipient · Detail · Category · USD · ZEC · Date · Status; filters by payment type (Grants / Contractors / Coinholder / Discretionary / Monthly), status (Cancelled / Completed / Open), category; search; totals (1,015 records, 821 paid, $23.3M, 414.73K ZEC); rows link to grant pages; entries tagged "from spreadsheet" or "admin entry"; CSV export; **no on-chain verification indicator** — exactly the cell a `receipt_url`/verified badge fills.
- **Zeceipt demo page** (our own, PROOF §2b): text-first, three inputs, one button; outcome table; proves/does-not-prove; node disclosure. Keep this shape for the public receipt page.
