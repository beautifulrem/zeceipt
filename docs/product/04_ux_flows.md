# UX flows, screens and copy

## 1. Design principles

1. Three-part outcome, never a single boolean: cryptographic validity · chain inclusion (confirmations) · issuer binding (confirmed / unknown / unsigned).
2. Proves / does-not-prove text is always visible next to a result (spec §4).
3. The receipt page needs no login and no server: verification runs in the browser; the page says which node it asks for the txid.
4. Money is shown as ZEC with 8 decimals and USD at the locked rate with its source and timestamp; never floats. Built (slices G1c2 and G1d; REQ-CON-4):
   - ZEC always shows 8 decimals ("1.01000000 ZEC", REQ-CON-4), with the last five lighter, as Zkool, the wallet the console pays through, shows amounts `[R73]`. Every digit is present, the columns align, and copying gives the whole number.
   - USD at the lock is computed with bigints and rounded to the cent once, beside the rate's exact bid, source and fetch time (REQ-CON-4, NFR-8).
5. English only (hackathon rule `[R1]`).

## 2. Flows

### FLOW-1 Issuer runs a batch (P1/P2)
1. Add payables by hand, or import CSV (Konclave `label,address,value[,memo]` or zecpay `name,wallet,amount,currency,payout_currency`; REQ-CON-19, baseline only — the solo branch is manual entry only) → validation report (bad UA, duplicate address, missing W-9/TIN for a `tax_flag = us_1099` recipient whose calendar-year aggregate reaches $2,000 `[R26]`; KYC status is shown but does not block).
2. Create batch → lock rate from one source with its timestamp (REQ-CON-4); at execution a > 3% move since the lock blocks until re-quote (REQ-CON-21). A second source with a cross-source disagreement check is REQ-CON-20 (Should; baseline cut item 4, dropped in the solo branch). Built (slices G1c2, G2b1, G2b2; REQ-CON-4, REQ-CON-21):
   - the batch page locks the rate (with its source and time) and offers Pay only once locked (REQ-CON-4);
   - every attempt that will pay is checked, and a move beyond the limit is refused with both rates, the limit and a re-lock prompt, while nothing is sent (REQ-CON-21);
   - a batch the wallet refused keeps its Re-lock form (REQ-CON-21).
3. Approvals: two approvers each see recipients, totals, rate; approve → HMAC recorded; any edit resets approvals.
4. Execute: choose backend (Zkool hot-custody · external signer via per-recipient ZIP-321 QR); confirm dialog restates totals.
5. Track: pending → broadcast → confirmed(n); failure rows retryable, no duplicates.
6. Receipts issued automatically (REQ-CON-11); links copied or emailed; export CSVs (OpenZcash / QBO / Xero, REQ-CON-14; 1099 totals NFR-9, baseline only).
Error states: rate source down (the lock is blocked and the batch stays in draft; falling back to a second source is REQ-CON-20, planned), backend unreachable (batch stays approved), tx not found after 30 min (mark "unknown outcome", require manual reconcile), recipient address on the wrong network (blocked at import).

### FLOW-2 Recipient verifies (P3)
1. Opens `https://<host>/r#<payload>` (or pastes a receipt into the demo page). The payload is in the fragment, so the page's host never receives it (spec §2.1).
2. Page loads wasm, shows "what this proves" before fetching anything.
3. Fetch raw tx from a public node (button; explains the txid is revealed to that node) or load a file.
4. Result: VALID with recipient/value/memo/label/issuer/challenge state; INVALID with the failing stage in plain words.
5. Optional: download JSON/PDF; if a challenge was issued to them, enter it.

### FLOW-3 Auditor verifies a pack (P4)
1. Receives `pack.json` (and optionally a challenge they issued).
2. `zeceipt verify-pack pack.json [--raw-tx-dir …] [--challenge …]` or the pack page.
3. Sees per-row outcome and `verified_total_zat` with the lower-bound sentence.
4. Exports the verified rows to their accounting format (REQ-CON-14).

### FLOW-4 Integrator (P5)
1. `cargo add zeceipt-core` or `npm i @zeceipt/verify`.
2. Issue: `issue(tx, keys, opts)` after broadcast → receipts (REQ-CORE-6); or `zeceipt issue` in CI (REQ-CLI-1).
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
| SCR-2 | Recipients | list, add/edit, validation errors, KYC/tax flags, linkability warning. Built (H1, H2; REQ-CON-2): the list (name; the address abridged to a prefix of the separator plus 25 data characters, at least ZIP 316's 20, with the whole address one click away in a `<details>`, as on the batch page `[R77]`; KYC, tax, settlement), duplicates flagged in words ("Pays the same Orchard receiver as …"), never blocked; the add form with each problem under its field and the values kept, working without JavaScript. Editing, archiving and the linkability warning (H6, REQ-CON-6) are not built |
| SCR-3 | Payables | import (report with row errors), list, filters by type/status |
| SCR-4 | Batch detail | draft / awaiting approvals / approved / executing / confirmed / failed rows; rate panel; approval log. Built so far (E1, E2, G1c2, G1d, G2b2; REQ-CON-4, REQ-CON-21): status and lifecycle; items with ZEC (8 decimals) and USD at the lock; the rate panel (rate, exact bid, source, time, Lock/Re-lock while no attempt may have paid); Pay only once locked; outcomes in plain words ("Rate moved" with both rates and the limit); receipts. Approvals are not built (REQ-CON-5 dropped in the solo branch) |
| SCR-5 | Execute dialog | backend choice, custody-mode notice, restated totals, confirm |
| SCR-6 | Receipts | per batch: links, copy, resend; issuance status |
| SCR-7 | Audit packs | build, download, share link |
| SCR-8 | Exports | OpenZcash / QuickBooks / Xero (REQ-CON-14); 1099 totals (NFR-9, baseline only); column preview |
| SCR-9 | Settings | members & roles, issuer keys (key id, rotation), well-known file, endpoints |
| SCR-10 | Public receipt page (`packages/verify/r/`, built in F2b) | loading the verifier (proves/does-not-prove already shown) · no receipt in the link · unreadable (parse copy) · receipt summary before any request · fetching from a named node / loading a file · waiting for the challenge (bound receipts only) · VALID with the three parts (inclusion: mined at H / pending in the mempool / not on the main chain / unknown from a file) · INVALID(stage copy) · not found yet (pending copy) |
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
