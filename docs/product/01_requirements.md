# Requirements

Priority: M = Must (hackathon MVP), S = Should, C = Could, W = Won't (v0). Status: ✅ implemented (evidence linked), 🟡 partial, ⬜ open. Every requirement has a testable acceptance criterion (AC).

## 0. Scope and non-goals

In scope for v0: per-output disclosure receipts on Ironwood (plus Orchard/Sapling), CLI, browser verifier/SDK, payout console that issues receipts, Solana attestation of verified receipts, exports for accounting and public ledgers.
Non-goals for v0: spend-authority proof (full ZIP 311), wallet/key custody in the app, FROST signing, mobile apps, fiat on/off-ramps, EOR/employment services, ZSA/stablecoin issuance, non-Zcash payouts.

## 1. Receipt core (`zeceipt-core`, `zeceipt-types`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-CORE-1 | M | Parse Zcash transactions v4, v5, v6 and enumerate Ironwood, Orchard and Sapling outputs with stable (pool, index) references. | A committed mainnet v6 tx parses; `enumerate_outputs` lists 2 Ironwood actions with indexes 0,1. | ✅ `parses_mainnet_v6_fixture_and_enumerates_ironwood_actions` |
| REQ-CORE-2 | M | Derive the per-output OCK from an outgoing viewing key using the protocol PRF for the correct domain (Ironwood/Orchard/Sapling). | Official Orchard vectors reproduce `ock`; Ironwood and Sapling round trips recover value/recipient/memo. | ✅ `official_orchard_test_vectors_ock_and_recovery`, `ironwood_round_trip_*`, `sapling_round_trip_*` |
| REQ-CORE-3 | M | Recover exactly one output from a disclosed OCK; a wrong key, wrong index or wrong domain must fail. | Tamper tests return `None`/`RecoveryFailed`; Ironwood domain rejects V2 notes. | ✅ same tests + `verify_rejects_txid_mismatch_and_wrong_index` |
| REQ-CORE-4 | M | Envelope v0 with canonical signing bytes covering every display-affecting field (network, pool, txid, index, ock, label, challenge, key id). | Flipping any of those fields after signing fails signature verification; committed vectors match. | ✅ `tamper_each_field_breaks_signature`, `committed_test_vectors_match` |
| REQ-CORE-5 | M | Verification fails closed in a fixed order: txid → signature → challenge → output → recovery; no partial success. | `offline_e2e` asserts each stage; CLI stages mirror it. | ✅ `tests/offline_e2e.rs` |
| REQ-CORE-6 | M | Issuance emits one receipt per output opened by the issuer's external OVK; change outputs only on request. | Synthetic and regtest issuance produce exactly one receipt for the payment output. | ✅ PROOF §2, §5 |
| REQ-CORE-7 | M | Audit pack: list of receipts with declared total; verifier recomputes a lower-bound total. | `verify-pack` returns `verified_total_zat` and the lower-bound note. | ✅ `inspect_issue_pack_and_verify_pack_offline` |
| REQ-CORE-8 | M | Regtest network support for local proofs. | `--regtest` issue/verify on a Zebra regtest tx. | ✅ PROOF §5 |
| REQ-CORE-9 | S | Spend-authority proof (ZIP 311 `spends` half) via a wallet-side signer. | A receipt carries a rerandomized spend-auth signature verifiable per ZIP 311. | ⬜ WBS 3.3.4.5 / roadmap |
| REQ-CORE-10 | S | Issuer key binding file format (`/.well-known/zeceipt.json`) with key ids and validity intervals; verifier upgrade-only semantics. | A receipt with unknown key id renders "issuer binding unknown", never invalid. | ⬜ REQ-INT-3 |

## 2. CLI (`zeceipt`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-CLI-1 | M | Subcommands: keygen, inspect, issue, verify, pack, verify-pack, find-ironwood. | `--help` lists all; each exercised in tests or PROOF. | ✅ `cli.rs` tests, PROOF |
| REQ-CLI-2 | M | Exit codes: 0 valid, 1 invalid, 2 pending, 3 usage. | Tests assert 0/1/3; pending path returns 2 on NotFound. | ✅ `usage_errors_exit_3_and_help_exits_0`, `failure_stages_and_exit_1` |
| REQ-CLI-3 | M | Failure stage reported in JSON (`parse/tx/txid/signature/challenge/output/recovery/network`). | Each stage asserted. | ✅ same |
| REQ-CLI-4 | M | Offline mode with `--raw-tx-file` / `--raw-tx-dir`. | Pack verification offline passes. | ✅ `inspect_issue_pack_and_verify_pack_offline` |
| REQ-CLI-5 | M | Network context guard: explicit `--testnet`/`--regtest` with a mainnet receipt is rejected at stage `network`. | Test asserts. | ✅ `failure_stages_and_exit_1` |
| REQ-CLI-6 | M | Never accept seeds or spending keys; inputs are UFVK or bare OVK. | CI step `source guards` (`scripts/check_source_guards.py`) fails if the whole words seed/mnemonic/spending appear in any crate's non-test code. | ✅ CI source guards (passes locally) |
| REQ-CLI-7 | S | Privacy modes: `--block-range` (scan blocks instead of asking for a txid) and `--tor`/custom endpoint. | Verifying via block range works on regtest without a `GetTransaction` call. | ⬜ WBS 3.2.1.4 |
| REQ-CLI-8 | S | Live integration test behind `--features live`. | CI job optional; local run documented. | ⬜ WBS 3.2.2.4 |

## 3. Browser verifier and SDK (`zeceipt-wasm`, `@zeceipt/verify`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-WEB-1 | M | Verify a receipt entirely in the browser from receipt + raw tx hex. | Chrome run shows VALID with recipient/value/memo. | ✅ PROOF §2b |
| REQ-WEB-2 | M | Same failure stages as CLI; tamper cases shown with stage. | Chrome run shows challenge/signature/recovery stages. | ✅ PROOF §2b |
| REQ-WEB-3 | M | No receipt-controlled string is interpolated as HTML. | `<b>` in label renders as text. | ✅ PROOF §2b |
| REQ-WEB-4 | M | Fetch raw tx over gRPC-web from public nodes with failover; page states that the node learns the txid. | Fetch of a mainnet txid succeeds from `zjs.zec.rocks`. | ✅ PROOF §2b |
| REQ-WEB-5 | M | Committed package must not drift from the format: node guard verifies committed vectors (all Network×Pool) through the committed wasm. | `node packages/verify/test/verify.mjs` ALL OK in CI. | ✅ CI step |
| REQ-WEB-6 | M | Signature-only check API for integrators. | `checkSignature()` returns signed/valid/pubkey. | ✅ `check_signature` export |
| REQ-WEB-7 | S | Receipt page renders the three-part outcome (cryptographic validity, chain inclusion, issuer binding). | Page shows the mined height when fetched from a node and states that confirmation depth must be checked elsewhere; issuer binding rendered as confirmed/unknown. | 🟡 mined height shown + depth disclaimer (PROOF §2b); binding lookup ⬜ (WBS 3.3.3.3) |
| REQ-WEB-8 | C | Publish `@zeceipt/verify` to npm with working links. | Package resolvable; README links live. | 👤 user action |

## 4. Payout console (`apps/console`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-CON-1 | M | Organisations, members, roles (Admin, Approver, Operator, Viewer); email login (SIWZ optional). | Role matrix enforced in route handlers; tests per role. | ⬜ |
| REQ-CON-2 | M | Recipients: display name, unified address (validated per network), KYC flag, tax flag (US-1099 / non-US), preferred settlement (ZEC / USDC-Solana). | Invalid UA rejected; duplicate addresses flagged. | ⬜ |
| REQ-CON-3 | M | Payables: type (milestone/invoice/bounty/salary), USD cents, reference, link to grant/project; CSV import compatible with Konclave `label,address,value[,memo]` and zecpay columns. | Import of both sample CSVs yields the expected payables. | ⬜ |
| REQ-CON-4 | M | Batches: group payables; lock ZEC/USD rate from two sources (Kraken, CoinGecko) recording both and the timestamp. | Rate, sources and timestamp persisted; deviation > 3% blocks until re-quote. | ⬜ |
| REQ-CON-5 | M | Two-person approval bound by HMAC over (batch id, recipients, amounts, rate); any edit invalidates approvals. | Editing an approved batch resets approvals; test. | ⬜ |
| REQ-CON-6 | M | Fresh diversified address per recipient per batch when the recipient supplied a UFVK-derived address set; otherwise warn about linkability. | UI warning shown; documented in spec §9. | ⬜ |
| REQ-CON-7 | M | Execution backend A: Zkool GraphQL `pay` with per-recipient memo (`INV-…`); idempotent re-submission guarded by a batch nonce. | Regtest batch of 3 recipients lands in one transaction. | ⬜ |
| REQ-CON-8 | S | Execution backend B: Zallet `z_sendmany` with duplicate-address splitting and unknown-outcome handling after opid loss. | Regtest run. | ⬜ |
| REQ-CON-9 | M | Execution backend C: per-recipient ZIP-321 URIs/QR for non-custodial mode (one recipient per URI; multi-recipient URIs are not used because Zodl rejects them). | URIs scan in YWallet/Zodl. | ⬜ |
| REQ-CON-10 | M | Batch state machine: draft → approved → submitted → broadcast → confirmed(n) → receipts issued; failures stay retryable; no silent duplicates. | State transitions tested; confirmations configurable. | ⬜ |
| REQ-CON-11 | M | Auto-issue one receipt per payment output after N confirmations; store receipt JSON, URL and recovered values. | Receipts appear with verify links; issuance is idempotent per (txid, index). | ⬜ |
| REQ-CON-12 | M | Public receipt page (no login) using the browser verifier; optional challenge input. | Page verifies without server involvement. | ⬜ |
| REQ-CON-13 | M | Audit pack page and JSON export; lower-bound wording. | Pack verifies in CLI and page. | ⬜ |
| REQ-CON-14 | M | Exports: OpenZcash-compatible CSV (+ `receipt_url`), QuickBooks 3-column, Xero single-amount, per-recipient annual USD totals for 1099-NEC. | Sample files validate against the column specs in `05_data_model_api.md` §3. | ⬜ |
| REQ-CON-15 | S | Notifications (Discord webhook / email) for pending approvals and confirmations. | Webhook fires on state changes. | ⬜ |
| REQ-CON-16 | S | UFVK-based reconciliation view (upper bound of outgoing payments). | Reconciles regtest batch against payables. | ⬜ |
| REQ-CON-17 | M | Custody modes documented and enforced: hot (seed only in Zkool; app holds UFVK) or external signer (app holds UFVK only). | Config test: `CUSTODY_MODE=external` with a Zkool endpoint set fails startup; `hot` without a Zkool endpoint fails startup; README states the demo mode. | ⬜ |

## 5. Solana attestation

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-SOL-1 | M | Anchor program with one instruction: verify an ed25519 signature via the native precompile over a canonical "verified row" (zcash txid, output index, recovered-values hash, USD cents, date, issuer key id) and store it in a PDA. | Program test passes on localnet. | ⬜ |
| REQ-SOL-2 | M | Rows are keyed by (txid, index); duplicates rejected. | Second submission fails with a typed error. | ⬜ |
| REQ-SOL-3 | M | TypeScript client verifies the receipt with `@zeceipt/verify` before submitting. | Invalid receipt never reaches the chain. | ⬜ |
| REQ-SOL-4 | M | Devnet deployment recorded in PROOF with program id and a transaction signature. | PROOF §7 entry. | ⬜ |
| REQ-SOL-5 | C | Backup Solana hook: NEAR Intents 1Click ZEC→USDC leg measured (min amount, time). | Quote and settlement recorded. | ⬜ |

## 6. Integrations

| ID | Pri | Requirement | Acceptance criterion | Status / evidence |
|---|---|---|---|---|
| REQ-INT-1 | S | Konclave adapter: from its CSV/ledger rows and a txid, issue receipts and write back a `receipt_url` column. | Sample Konclave CSV processed on regtest. | ⬜ |
| REQ-INT-2 | S | OpenZcash column-compatible export plus `receipt_url`; demo branch showing a "verified" badge. | Columns match `[R5]` list. | ⬜ |
| REQ-INT-3 | S | Well-known issuer key file generator; verifier upgrade path (never downgrade). | CLI `keys publish` writes the file; verify shows "binding confirmed". | ⬜ |
| REQ-INT-4 | S | Format feedback posted to zips #387 and the forum with a link to vectors. | Post URL recorded. | ⬜ |

## 7. Non-functional requirements

| ID | Requirement | Acceptance criterion | Status |
|---|---|---|---|
| NFR-1 Security | No spending keys, seeds or mnemonics accepted anywhere in the workspace; `#![forbid(unsafe_code)]` in every crate; no `unwrap` outside tests. | CI step `source guards` (`scripts/check_source_guards.py`) scans all five crates' non-test code for the whole words seed/mnemonic/spending and fails on a hit; clippy `-D warnings`; attribute present in all five crates. | ✅ CI source guards (passes locally, 6 files) |
| NFR-2 Privacy | Only per-output OCKs are disclosed; UFVK/OVK never leave the issuer; hosted verifier discloses which txid it fetches. | Spec §9; demo copy. | ✅ |
| NFR-3 Reliability | Endpoint failover; `pending` distinct from `invalid`; idempotent issuance. | lwd tests; CLI exit 2 path. | ✅ (console idempotency ⬜) |
| NFR-4 Performance | Browser verify < 1 s after wasm load for a 20 KB tx; CLI issue < 5 s per tx on public nodes. | Chrome 153 on `demo/index.html`: 7.28 ms per verify on the largest fixture (9,166 bytes). No 20 KB fixture exists: verification decrypts exactly one output, so cost is dominated by transaction parsing, linear in bytes — a 20 KB transaction is ≈ 2× parse work, ≈ 15 ms, ~65× inside the 1 s budget (extrapolated, not measured). Node: init 13.9 ms. CLI issue = fetch (1.15 s measured, `inspect` over gRPC) + trial-decrypt/sign (offline `issue --regtest` 0.00 s wall) < 5 s. PROOF §2b. | 🟡 measured on 9 KB in Chrome; 20 KB condition extrapolated |
| NFR-5 Portability | Pure-Rust core compiles to wasm32; Linux/macOS CI. | wasm-pack build; CI file. | ✅ |
| NFR-6 Observability | `tracing` levels; secrets never above `trace`. | CI step `source guards` fails if any `trace!/debug!/info!/warn!/error!` line in any crate mentions the whole words ock/ovk/memo. | ✅ CI source guards (passes locally) |
| NFR-7 Accessibility & copy | English UI; outcomes have text not only colour; proves/does-not-prove always shown. | Node guard asserts the demo page source contains the words "proves" and "does not prove" and that result rows carry a text label (`packages/verify/test/verify.mjs`, copy check). | ✅ demo page (copy check in node guard, 2026-09-22); console ⬜ |
| NFR-8 Compliance data | Store FMV source, rate and timestamp per payment; per-recipient annual USD totals. | Console export test. | ⬜ |

## 8. Traceability matrix (requirement → WBS leaf → evidence)

One row per requirement. Evidence for ✅ rows is a test name, a PROOF section or a repo file (`[R37]` is the proof log itself); ⬜/🟡 rows point at the plan. Checked by `scripts/check_product_docs.py` (leaf numbers exist; test names exist under `crates/`; no ⬜ row cites PROOF).

| Requirement | Status | WBS leaf | Evidence or plan |
|---|---|---|---|
| REQ-CORE-1 | ✅ | 3.1.2.1 | test `parses_mainnet_v6_fixture_and_enumerates_ironwood_actions` |
| REQ-CORE-2 | ✅ | 3.1.2.2 | tests `official_orchard_test_vectors_ock_and_recovery`, `ironwood_round_trip_ock_derivation_and_recovery`, `sapling_round_trip_ock_derivation_and_recovery` |
| REQ-CORE-3 | ✅ | 3.1.2.2 | same tests + `verify_rejects_txid_mismatch_and_wrong_index` |
| REQ-CORE-4 | ✅ | 3.1.3.1 | tests `tamper_each_field_breaks_signature`, `committed_test_vectors_match` |
| REQ-CORE-5 | ✅ | 3.1.2.3 | `crates/zeceipt-core/tests/offline_e2e.rs` |
| REQ-CORE-6 | ✅ | 3.1.2.3 | PROOF §2, §5 `[R37]` |
| REQ-CORE-7 | ✅ | 3.1.3.3 | test `audit_pack_round_trip`; CLI test `inspect_issue_pack_and_verify_pack_offline` |
| REQ-CORE-8 | ✅ | 3.1.2.4 | PROOF §5 (regtest) `[R37]` |
| REQ-CORE-9 | ⬜ | 3.3.4.5 | Should 8 prototype (`11_plan.md` §1); first item in the cut order |
| REQ-CORE-10 | ⬜ | 3.3.3.3 | `05_data_model_api.md` §4 well-known file |
| REQ-CLI-1 | ✅ | 3.2.1.1 | `crates/zeceipt-cli/tests/cli.rs`; PROOF §2 |
| REQ-CLI-2 | ✅ | 3.2.1.2 | tests `usage_errors_exit_3_and_help_exits_0`, `failure_stages_and_exit_1` |
| REQ-CLI-3 | ✅ | 3.2.1.2 | test `failure_stages_and_exit_1` |
| REQ-CLI-4 | ✅ | 3.2.1.3 | test `inspect_issue_pack_and_verify_pack_offline` |
| REQ-CLI-5 | ✅ | 3.2.1.2 | test `failure_stages_and_exit_1` (stage `network`) |
| REQ-CLI-6 | ✅ | 3.4.2.1 | CI source guards (`scripts/check_source_guards.py`) |
| REQ-CLI-7 | ⬜ | 3.2.1.4 | planned: `--block-range`, `--tor` |
| REQ-CLI-8 | ⬜ | 3.2.2.4 | planned: `--features live` |
| REQ-WEB-1 | ✅ | 3.2.3.3 | PROOF §2b `[R37]` |
| REQ-WEB-2 | ✅ | 3.2.3.3 | PROOF §2b (stage shown for tamper cases) |
| REQ-WEB-3 | ✅ | 3.2.3.3 | PROOF §2b (escaping check) |
| REQ-WEB-4 | ✅ | 3.2.3.2 | PROOF §2b (fetch from `zjs.zec.rocks`); `packages/verify/src/index.js` |
| REQ-WEB-5 | ✅ | 3.2.3.4 | `packages/verify/test/verify.mjs`; CI node guard |
| REQ-WEB-6 | ✅ | 3.2.3.1 | `check_signature` export in `crates/zeceipt-wasm/src/lib.rs` |
| REQ-WEB-7 | 🟡 | 3.3.6.2 | mined height shown (PROOF §2b); binding lookup with 3.3.3.3 |
| REQ-WEB-8 | 👤 | 4.1.1.3 | npm publish after links resolve |
| REQ-CON-1 | ⬜ | 3.3.1.2 | auth/session + role matrix |
| REQ-CON-2 | ⬜ | 3.3.1.3 | `05_data_model_api.md` §1 `recipients` |
| REQ-CON-3 | ⬜ | 3.3.5.1 | `05` §1 `payables`; `[R10]` Konclave CSV, `[R12]` zecpay columns |
| REQ-CON-4 | ⬜ | 3.3.5.2 | `05` §1 `batches` rate fields |
| REQ-CON-5 | ⬜ | 3.3.5.3 | `05` §1 `approvals` HMAC |
| REQ-CON-6 | ⬜ | 3.3.5.1 | `04_ux_flows.md` SCR-2 linkability warning; spec §9 |
| REQ-CON-7 | ⬜ | 3.3.5.4 | `05` §2 zkool-graphql adapter `[R18]` |
| REQ-CON-8 | ⬜ | 3.3.5.5 | `05` §2 zallet-rpc adapter `[R19]` |
| REQ-CON-9 | ⬜ | 3.3.5.6 | `05` §2 zip321-manual adapter `[R17]` |
| REQ-CON-10 | ⬜ | 3.3.5.2 | `05` §1 batch state machine |
| REQ-CON-11 | ⬜ | 3.3.6.1 | auto-issuance via `zeceipt_core::issue` |
| REQ-CON-12 | ⬜ | 3.3.6.2 | `04` SCR-10, FLOW-2 |
| REQ-CON-13 | ⬜ | 3.3.6.3 | `04` SCR-11, FLOW-3 |
| REQ-CON-14 | ⬜ | 3.3.6.3 | `05` §3 export columns `[R5]` `[R32]` |
| REQ-CON-15 | ⬜ | 3.3.6.4 | cut order item 2 (`11_plan.md` §2) |
| REQ-CON-16 | ⬜ | 3.3.6.4 | cut order item 2 |
| REQ-CON-17 | ⬜ | 3.3.1.1 | `docs/THREAT_MODEL.md` custody modes; `04` SCR-5 notice; config validation |
| REQ-SOL-1 | ⬜ | 3.3.2.1 | `05` §4 attestation row |
| REQ-SOL-2 | ⬜ | 3.3.2.1 | PDA keyed by (txid, index) |
| REQ-SOL-3 | ⬜ | 3.3.2.2 | client verifies with `@zeceipt/verify` first |
| REQ-SOL-4 | ⬜ | 3.3.2.3 | devnet deployment; evidence section to be added to the proof log |
| REQ-SOL-5 | ⬜ | 3.3.2.4 | `[R33]` asset ids known; quote/min amount to measure |
| REQ-INT-1 | ⬜ | 3.3.3.1 | `[R10]` CSV format |
| REQ-INT-2 | ⬜ | 3.3.3.2 | `[R5]` columns; `05` §3.1 |
| REQ-INT-3 | ⬜ | 3.3.3.3 | `05` §4 well-known contract |
| REQ-INT-4 | ⬜ | 3.3.3.4 | zips #387 post planned 2026-09-27 |
| NFR-1 | ✅ | 3.4.2.1 | CI source guards; clippy `-D warnings`; `forbid(unsafe_code)` in all five crates |
| NFR-2 | ✅ | 3.2.3.3 | spec §9; demo page node disclosure (PROOF §2b) |
| NFR-3 | ✅ | 3.2.2.3 | lwd unit tests; exit 2 path; console idempotency with 3.3.6.1 |
| NFR-4 | 🟡 | 3.4.2.1 | PROOF §2b timing (2026-09-22); 20 KB fixture still to capture |
| NFR-5 | ✅ | 3.2.3.1 | wasm-pack build; CI wasm job |
| NFR-6 | ✅ | 3.4.2.1 | CI source guards (log-line rule) |
| NFR-7 | ✅ | 3.2.3.4 | node guard copy check; console with 3.3.6.2 |
| NFR-8 | ⬜ | 3.3.6.3 | exports test (REQ-CON-14) |
