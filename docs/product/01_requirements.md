# Requirements

Priority: M = Must (hackathon MVP), S = Should, C = Could, W = Won't (v0). Status: ✅ implemented (evidence linked), 🟡 partial, ⬜ open. Every requirement has a testable acceptance criterion (AC).

## 0. Scope and non-goals

In scope for v0: per-output disclosure receipts on Ironwood (plus Orchard/Sapling), CLI, browser verifier/SDK, payout console that issues receipts, Solana attestation of verified receipts, exports for accounting and public ledgers.
Non-goals for v0: spend-authority proof (full ZIP 311), fresh-diversifier address derivation (REQ-CON-18), wallet/key custody in the app, FROST signing, mobile apps, fiat on/off-ramps, EOR/employment services, ZSA/stablecoin issuance, non-Zcash payouts.

Priorities are stated for the two-person baseline plan. Under the solo branch (`11_plan.md` §1.1, RSK-19, decision 2026-09-24) the Must set reduces to REQ-CORE-1..8, REQ-CLI-1..6, REQ-WEB-1..6, REQ-CON-2, REQ-CON-3, REQ-CON-4, REQ-CON-6, REQ-CON-7, REQ-CON-10, REQ-CON-11, REQ-CON-12, REQ-CON-17 and REQ-CON-21. Everything already delivered (✅) stays; REQ-WEB-7 (🟡) stays because its leaf is kept; REQ-WEB-8 remains a user action outside the budget; REQ-CORE-9/-10, REQ-CLI-7/-8, REQ-CON-1/-5/-8/-9/-13/-14/-15/-16/-19/-20, REQ-SOL-1..5, REQ-INT-1..4 and NFR-9 (the annual-totals export, leaf 3.3.6.3) are dropped for the hackathon; NFR-8 (FMV data stored per batch, leaf 3.3.5.2) is kept. REQ-CON-18 (fresh-diversifier derivation) is Won't for v0 under both branches. Where a partial obligation would have needed a qualified value it has been split into its own requirement (REQ-CON-18, REQ-CON-19, REQ-CON-20, NFR-9), so every Solo value is a plain kept or dropped; the checker verifies each value against the solo kept/dropped lists (✅ leaves count as kept) and rejects qualified values.

## 1. Receipt core (`zeceipt-core`, `zeceipt-types`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-CORE-1 | M | Parse Zcash transactions v4, v5, v6 and enumerate Ironwood, Orchard and Sapling outputs with stable (pool, index) references. | A committed mainnet v6 tx parses; `enumerate_outputs` lists 2 Ironwood actions with indexes 0,1. | ✅ `parses_mainnet_v6_fixture_and_enumerates_ironwood_actions` | kept (done) |
| REQ-CORE-2 | M | Derive the per-output OCK from an outgoing viewing key using the protocol PRF for the correct domain (Ironwood/Orchard/Sapling). | Official Orchard vectors reproduce `ock`; Ironwood and Sapling round trips recover value/recipient/memo. | ✅ `official_orchard_test_vectors_ock_and_recovery`, `ironwood_round_trip_*`, `sapling_round_trip_*` | kept (done) |
| REQ-CORE-3 | M | Recover exactly one output from a disclosed OCK; a wrong key, wrong index or wrong domain must fail. | Tamper tests return `None`/`RecoveryFailed`; Ironwood domain rejects V2 notes. | ✅ same tests + `verify_rejects_txid_mismatch_and_wrong_index` | kept (done) |
| REQ-CORE-4 | M | Envelope v0 with canonical signing bytes covering every display-affecting field (network, pool, txid, index, ock, label, challenge, key id). | Flipping any of those fields after signing fails signature verification; committed vectors match. | ✅ `tamper_each_field_breaks_signature`, `committed_test_vectors_match` | kept (done) |
| REQ-CORE-5 | M | Verification fails closed in a fixed order: txid → signature → challenge → output → recovery; no partial success. | `offline_e2e` asserts each stage; CLI stages mirror it. | ✅ `tests/offline_e2e.rs` | kept (done) |
| REQ-CORE-6 | M | Issuance emits one receipt per output the issuer's viewing key opens (either ZIP 32 scope); change outputs — recipients that are the issuer's own addresses — only on request. | Synthetic and regtest issuance produce exactly one receipt per payment output; on the Zkool 4-action fixture exactly 3 receipts without `--include-change` and 4 with, the extra flagged `is_change`. | ✅ PROOF §2, §5, §5b; tests `zkool_batch_fixture_excludes_change_by_own_address`, `is_change_is_null_with_bare_ovk_and_boolean_with_ufvk` | kept (done) |
| REQ-CORE-7 | M | Audit pack: list of receipts with declared total; verifier recomputes a lower-bound total. | `verify-pack` returns `verified_total_zat` and the lower-bound note. | ✅ `inspect_issue_pack_and_verify_pack_offline` | kept (done) |
| REQ-CORE-8 | M | Regtest network support for local proofs. | `--regtest` issue/verify on a Zebra regtest tx. | ✅ PROOF §5 | kept (done) |
| REQ-CORE-9 | S | Spend-authority proof (ZIP 311 `spends` half) via a wallet-side signer. | A receipt carries a rerandomized spend-auth signature verifiable per ZIP 311. | ⬜ WBS 3.3.4.5 / roadmap | dropped |
| REQ-CORE-10 | S | Issuer key binding file format (`/.well-known/zeceipt.json`) with key ids and validity intervals; verifier upgrade-only semantics. | A receipt with unknown key id renders "issuer binding unknown", never invalid. | ⬜ REQ-INT-3 | dropped |

## 2. CLI (`zeceipt`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-CLI-1 | M | Subcommands: keygen, inspect, issue, verify, pack, verify-pack, find-ironwood. | `--help` lists all; each exercised in tests or PROOF. | ✅ `cli.rs` tests, PROOF | kept (done) |
| REQ-CLI-2 | M | Exit codes: 0 valid, 1 invalid, 2 pending, 3 usage. | Tests assert 0/1/3; pending path returns 2 on NotFound. | ✅ `usage_errors_exit_3_and_help_exits_0`, `failure_stages_and_exit_1` | kept (done) |
| REQ-CLI-3 | M | Failure stage reported in JSON using the REQ-CORE-5 stage names plus the CLI-only stages `parse`, `tx` and `network`. | Each stage asserted. | ✅ same | kept (done) |
| REQ-CLI-4 | M | Offline mode with `--raw-tx-file` / `--raw-tx-dir`. | Pack verification offline passes. | ✅ `inspect_issue_pack_and_verify_pack_offline` | kept (done) |
| REQ-CLI-5 | M | Network context guard: explicit `--testnet`/`--regtest` with a mainnet receipt is rejected at stage `network`. | Test asserts. | ✅ `failure_stages_and_exit_1` | kept (done) |
| REQ-CLI-6 | M | Never accept seeds or spending keys; inputs are UFVK or bare OVK. | CI step `source guards` (`scripts/check_source_guards.py`) fails if the whole words seed/mnemonic/spending appear in any crate's non-test code or in a script without the documented regtest-harness carve-out. | ✅ CI source guards (passes locally) | kept (done) |
| REQ-CLI-7 | S | Privacy modes: `--block-range` (scan blocks instead of asking for a txid) and `--tor`/custom endpoint. | Verifying via block range works on regtest without a `GetTransaction` call. | ⬜ WBS 3.2.1.4 | dropped |
| REQ-CLI-8 | S | Live integration test behind `--features live`. | CI job optional; local run documented. | ⬜ WBS 3.2.2.4 | dropped |

## 3. Browser verifier and SDK (`zeceipt-wasm`, `@zeceipt/verify`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-WEB-1 | M | Verify a receipt entirely in the browser from receipt + raw tx hex. | Chrome run shows VALID with recipient/value/memo. | ✅ PROOF §2b | kept (done) |
| REQ-WEB-2 | M | Same failure stages as CLI; tamper cases shown with stage. | Chrome run shows challenge/signature/recovery stages. | ✅ PROOF §2b | kept (done) |
| REQ-WEB-3 | M | No receipt-controlled string is interpolated as HTML. | `<b>` in label renders as text. | ✅ PROOF §2b | kept (done) |
| REQ-WEB-4 | M | Fetch raw tx over gRPC-web from public nodes with failover; page states that the node learns the txid. | Fetch of a mainnet txid succeeds from `zjs.zec.rocks`. | ✅ PROOF §2b | kept (done) |
| REQ-WEB-5 | M | Committed package must not drift from the format: node guard verifies committed vectors (all Network×Pool) through the committed wasm. | `node packages/verify/test/verify.mjs` ALL OK in CI. | ✅ CI step | kept (done) |
| REQ-WEB-6 | M | Signature-only check API for integrators. | `checkSignature()` returns signed/valid/pubkey. | ✅ `check_signature` export | kept (done) |
| REQ-WEB-7 | S | Receipt page renders the three-part outcome (cryptographic validity, chain inclusion, issuer binding). | Page shows the mined height when fetched from a node and states that confirmation depth must be checked elsewhere; issuer binding rendered as confirmed/unknown. | 🟡 mined height shown + depth disclaimer (PROOF §2b); binding lookup ⬜ (WBS 3.3.3.3) | kept (leaf 3.3.6.2) |
| REQ-WEB-8 | C | Publish `@zeceipt/verify` to npm with working links. | Package resolvable; README links live. | 👤 user action | kept (user action, outside the budget) |

## 4. Payout console (`apps/console`)

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-CON-1 | M | Organisations, members, roles (Admin, Approver, Operator, Viewer); email login (SIWZ optional). | Role matrix enforced in route handlers; tests per role. | ⬜ | dropped |
| REQ-CON-2 | M | Recipients: display name, unified address (validated per network), KYC flag, tax flag (US-1099 / non-US), preferred settlement (ZEC / USDC-Solana). | Invalid UA rejected; duplicate addresses flagged. | ⬜ | kept |
| REQ-CON-3 | M | Payables: type (milestone/invoice/bounty/salary), USD cents, reference, link to grant/project; manual entry with validation. | Creating a payable by hand persists all fields; invalid USD or missing reference is rejected. | ⬜ | kept (leaf 3.3.5.1) |
| REQ-CON-4 | M | Batches: group payables; lock the ZEC/USD rate from one source recording the source and the timestamp. | Rate, source and timestamp persisted on the batch. | ⬜ | kept (leaf 3.3.5.2) |
| REQ-CON-5 | M | Two-person approval bound by HMAC over (batch id, recipients, amounts, rate); any edit invalidates approvals. | Editing an approved batch resets approvals; test. | ⬜ | dropped |
| REQ-CON-6 | M | Warn about linkability whenever a recipient is paid at an address already used in a previous receipt (a receipt reveals that output's diversified address). | UI warning shown on SCR-2 and in the batch validation report; wording matches spec §9. | ⬜ | kept (leaf 3.3.5.1) |
| REQ-CON-7 | M | Execution backend A: Zkool GraphQL `pay` with per-recipient memo (`INV-…`); idempotent re-submission guarded by a batch nonce. | Regtest batch of 3 recipients lands in one transaction; submitting the same nonce again returns the same txid without a second payment. | ✅ PROOF §5b (backend) and §5c (library: one nonce submitted three times → one tx in block 2468); tests `submit is idempotent per nonce…`, two-process race, reconciliation, expiry-bounded retry after an uncertain outcome gated on the scanned height (`apps/console/test/zkool-backend.test.ts`) | kept |
| REQ-CON-8 | S | Execution backend B: Zallet `z_sendmany` with duplicate-address splitting and unknown-outcome handling after opid loss. | Regtest run. | ⬜ | dropped |
| REQ-CON-9 | M | Execution backend C: per-recipient ZIP-321 URIs/QR for non-custodial mode (one recipient per URI; multi-recipient URIs are not used because Zodl rejects them). | URIs scan in YWallet/Zodl. | ⬜ | dropped |
| REQ-CON-10 | M | Batch state machine: draft → approved → submitted → broadcast → confirmed(n) → receipts issued; failures stay retryable; no silent duplicates. | State transitions tested; confirmations configurable. | ⬜ | kept |
| REQ-CON-11 | M | Auto-issue one receipt per payment output after N confirmations; store receipt JSON, URL and recovered values. | Receipts appear with verify links; issuance is idempotent per (txid, index). | 🟡 issuance (`autoIssue`: N-confirmation gate, batch allow-list, per-item cross-check, verification; PROOF §5c), storage sealed at rest with the unique (org, txid, pool, index) key (slice B2), HTTP (slice D3: idempotent, 202 waiting below the threshold) and the batch page (slices E1/E2: receipts listed with their links, an Issue receipts action once confirmed) done; on the live chain through the app: PROOF §5d (three receipts verified online). Open: issuance without a click (a worker that issues on confirmation) | kept |
| REQ-CON-12 | M | Public receipt page (no login) using the browser verifier; optional challenge input. | Page verifies without server involvement. | ✅ PROOF §2c | kept |
| REQ-CON-13 | M | Audit pack page and JSON export; lower-bound wording. | Pack verifies in CLI and page. | ⬜ | dropped |
| REQ-CON-14 | M | Exports: OpenZcash-compatible CSV (+ `receipt_url`), QuickBooks 3-column, Xero single-amount (the 1099 totals export is NFR-9). | Sample files validate against the column specs in `05_data_model_api.md` §3. | ⬜ | dropped |
| REQ-CON-15 | S | Notifications (Discord webhook / email) for pending approvals and confirmations. | Webhook fires on state changes. | ⬜ | dropped |
| REQ-CON-16 | S | UFVK-based reconciliation view (upper bound of outgoing payments). | Reconciles regtest batch against payables. | ⬜ | dropped |
| REQ-CON-17 | M | Custody modes documented and enforced: hot (seed only in Zkool; app holds UFVK) or external signer (app holds UFVK only). | Config test: `CUSTODY_MODE=external` with a Zkool endpoint set fails startup; `hot` without a Zkool endpoint fails startup; README states the demo mode. | ✅ config rules and test: `apps/console/lib/config/env.ts`, `test/config.test.ts` (REQ-CON-17 case); startup: `next start` exits with code 1 before answering any request for `external` + a Zkool endpoint and for `hot` without one (`test/app.e2e.test.ts`, CI); README "Configuration and custody modes" states the demo mode | kept |
| REQ-CON-18 | W | Derive a fresh diversified address per recipient per batch from a recipient-supplied UFVK (removes the linkability the warning describes). | A batch paying the same recipient twice uses two distinct diversified addresses derived from their UFVK. | ⬜ no leaf; roadmap (post-hackathon) | dropped |
| REQ-CON-19 | S | CSV import of payables compatible with Konclave `label,address,value[,memo]` and zecpay columns. | Import of both sample CSVs yields the expected payables. | ⬜ | dropped |
| REQ-CON-20 | S | Second rate source (CoinGecko alongside Kraken) recorded with the first; > 3% disagreement between the two sources blocks until re-quote. | Both sources persisted; cross-source deviation test blocks. | ⬜ | dropped |
| REQ-CON-21 | M | Block execution when the rate has moved more than 3% between the approval lock and the execution quote (single source compared with itself over time). | Execution with a moved rate is rejected until re-quoted; test with a mocked rate feed. | ⬜ | kept (leaf 3.3.5.9) |

## 5. Solana attestation

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-SOL-1 | M | Anchor program with one instruction: verify an ed25519 signature via the native precompile over a canonical "verified row" (zcash txid, output index, recovered-values hash, USD cents, date, issuer key id) and store it in a PDA. | Program test passes on localnet. | ⬜ | dropped |
| REQ-SOL-2 | M | Rows are keyed by (txid, index); duplicates rejected. | Second submission fails with a typed error. | ⬜ | dropped |
| REQ-SOL-3 | M | TypeScript client verifies the receipt with `@zeceipt/verify` before submitting. | Invalid receipt never reaches the chain. | ⬜ | dropped |
| REQ-SOL-4 | M | Devnet deployment recorded in PROOF with program id and a transaction signature. | PROOF §7 entry. | ⬜ | dropped |
| REQ-SOL-5 | C | Backup Solana hook: NEAR Intents 1Click ZEC→USDC leg measured (min amount, time). | Quote and settlement recorded. | ⬜ | dropped |

## 6. Integrations

| ID | Pri | Requirement | Acceptance criterion | Status / evidence | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|---|
| REQ-INT-1 | S | Konclave adapter: from its CSV/ledger rows and a txid, issue receipts and write back a `receipt_url` column. | Sample Konclave CSV processed on regtest. | ⬜ | dropped |
| REQ-INT-2 | S | OpenZcash column-compatible export plus `receipt_url`; demo branch showing a "verified" badge. | Columns match `[R5]` list. | ⬜ | dropped |
| REQ-INT-3 | S | Well-known issuer key file generator; verifier upgrade path (never downgrade). | CLI `keys publish` writes the file; verify shows "binding confirmed". | ⬜ | dropped |
| REQ-INT-4 | S | Format feedback posted to zips #387 and the forum with a link to vectors. | Post URL recorded. | ⬜ | dropped |

## 7. Non-functional requirements

| ID | Requirement | Acceptance criterion | Status | Solo branch (`11_plan.md` §1.1) |
|---|---|---|---|---|
| NFR-1 Security | No spending keys, seeds or mnemonics accepted by the shipped crates, CLI or verifier; `#![forbid(unsafe_code)]` in every crate; no `unwrap` outside tests. Carve-out: `scripts/zkool_regtest_tracer.py` is a regtest-only harness that reads a throwaway regtest mnemonic from a file outside the repository to drive a local wallet backend (marker `# key-material-allowed` in its first lines). | CI step `source guards` (`scripts/check_source_guards.py`) scans all five crates' non-test code, the console library `apps/console/lib/**/*.ts` and `apps/console/db/**/*.ts` and the console app (`app/**/*.ts(x)`, `instrumentation.ts`, `proxy.ts`, `next.config.ts`) (no carve-out possible) and every `scripts/**/*.py` and `*.sh` for the whole words seed/mnemonic/spending and fails on a hit unless the file carries the header marker and the line is tagged; clippy `-D warnings`; attribute present in all five crates. | ✅ guard output, verified by `check_product_docs.py` against a live run: `source guards: 6 crate files + 57 console lib/db/app files + 3 browser verifier files + 6 scripts scanned (carve-out files: 1)` (1 carve-out file with 2 tagged lines) | kept |
| NFR-2 Privacy | Only per-output OCKs are disclosed; UFVK/OVK never leave the issuer; hosted verifier discloses which txid it fetches. | Spec §9; demo copy. | ✅ | kept |
| NFR-3 Reliability | Endpoint failover; `pending` distinct from `invalid`; idempotent issuance. | lwd tests; CLI exit 2 path. | ✅ (console idempotency ⬜) | kept |
| NFR-4 Performance | Browser verify < 1 s after wasm load for a transaction up to 20 KB; CLI issue < 5 s per tx on public nodes. Measured in Chrome 153 on `demo/index.html`: 7.28 ms per verify at 9,166 bytes and 6.05 ms at 15,478 bytes (the Zkool batch fixture, now the largest committed, 77 % of 20 KB) — flat in transaction size because exactly one output is trial-decrypted; more than 130× inside the 1 s budget; the last 23 % to 20 KB is not measured. Node: init 13.9 ms. CLI issue = fetch (1.15 s measured, `inspect` over gRPC) + trial-decrypt/sign (offline `issue --regtest` 0.00 s wall) < 5 s. PROOF §2b. | ✅ measured at 9 KB and 15 KB in Chrome; the last 23 % to 20 KB bounded, not measured (WBS 3.4.2.4 note) | kept |
| NFR-5 Portability | Pure-Rust core compiles to wasm32; Linux/macOS CI. | wasm-pack build; CI file. | ✅ | kept |
| NFR-6 Observability | `tracing` levels; secrets never above `trace`. | CI step `source guards` fails if any `trace!/debug!/info!/warn!/error!` line in any crate mentions the whole words ock/ovk/memo. | ✅ CI source guards (passes locally) | kept |
| NFR-7 Accessibility & copy | English UI; outcomes have text not only colour; proves/does-not-prove always shown. | Node guard asserts the demo page source contains the words "proves" and "does not prove" and that result rows carry a text label (`packages/verify/test/verify.mjs`, copy check). | ✅ demo page (copy check in node guard, 2026-09-22); console ⬜ | kept |
| NFR-8 Compliance data | Store the FMV source, rate and timestamp per payment. | Batch rows persist `rate_zec_usd`, `rate_sources_json` (≥ 1 entry; REQ-CON-20 adds the second) and `rate_locked_at` (`05_data_model_api.md` §1); migration test. | ⬜ | kept (leaf 3.3.5.2) |
| NFR-9 Compliance export | Export per-recipient calendar-year USD totals for 1099-NEC preparation. | Console export test against `05_data_model_api.md` §3.4 columns. | ⬜ | dropped (exports leaf 3.3.6.3 is dropped) |

## 8. Traceability matrix (requirement → WBS leaf → evidence)

One row per requirement. Evidence for ✅ rows is a test name, a PROOF section or a repo file (`[R37]` is the proof log itself); ⬜/🟡 rows point at the plan. Checked by `scripts/check_product_docs.py` (leaf numbers exist; test names exist under `crates/`; no ⬜ row cites PROOF).

| Requirement | Status | WBS leaf | Evidence or plan |
|---|---|---|---|
| REQ-CORE-1 | ✅ | 3.1.2.1 | test `parses_mainnet_v6_fixture_and_enumerates_ironwood_actions` |
| REQ-CORE-2 | ✅ | 3.1.2.2 | tests `official_orchard_test_vectors_ock_and_recovery`, `ironwood_round_trip_ock_derivation_and_recovery`, `sapling_round_trip_ock_derivation_and_recovery` |
| REQ-CORE-3 | ✅ | 3.1.2.2 | same tests + `verify_rejects_txid_mismatch_and_wrong_index` |
| REQ-CORE-4 | ✅ | 3.1.3.1 | tests `tamper_each_field_breaks_signature`, `committed_test_vectors_match` |
| REQ-CORE-5 | ✅ | 3.1.2.3 | `crates/zeceipt-core/tests/offline_e2e.rs` |
| REQ-CORE-6 | ✅ | 3.1.2.3 | PROOF §2, §5, §5b `[R37]`; tests `zkool_batch_fixture_excludes_change_by_own_address`, `is_change_is_null_with_bare_ovk_and_boolean_with_ufvk` |
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
| REQ-WEB-7 | 🟡 | 3.3.6.2 | mined height shown (PROOF §2b); chain status mined/mempool/fork from the node (F2a, `[R67]`); the receipt page renders all three parts, with binding shown as unknown (PROOF §2c); binding lookup with 3.3.3.3 |
| REQ-WEB-8 | 👤 | 4.1.1.3 | npm publish after links resolve |
| REQ-CON-1 | ⬜ | 3.3.1.2 | auth/session + role matrix |
| REQ-CON-2 | ⬜ | 3.3.1.3 | `05_data_model_api.md` §1 `recipients` |
| REQ-CON-3 | ⬜ | 3.3.5.1 | `05` §1 `payables` |
| REQ-CON-4 | ⬜ | 3.3.5.2 | `05` §1 `batches` rate fields |
| REQ-CON-5 | ⬜ | 3.3.5.3 | `05` §1 `approvals` HMAC |
| REQ-CON-6 | ⬜ | 3.3.5.1 | `04_ux_flows.md` SCR-2 linkability warning; spec §9 |
| REQ-CON-7 | ✅ | 3.3.5.4 | PROOF §5b, §5c, §5d (the console app on the live chain: the pay form posted twice, one transaction); `apps/console/lib/execution/zkool-backend.ts`; `apps/console/test/zkool-backend.test.ts`; over HTTP: `apps/console/test/submit-routes.test.ts`, the `next start` submit test in `test/app.e2e.test.ts`, and `test/regtest.http.e2e.test.ts` `[R18]` `[R61]` |
| REQ-CON-8 | ⬜ | 3.3.5.5 | `05` §2 zallet-rpc adapter `[R19]` |
| REQ-CON-9 | ⬜ | 3.3.5.6 | `05` §2 zip321-manual adapter `[R17]` |
| REQ-CON-10 | ⬜ | 3.3.5.2 | `05` §1 batch state machine |
| REQ-CON-11 | 🟡 | 3.3.6.1 | PROOF §5c, §5d (three receipts issued from the page on the live chain, each verified online); `apps/console/lib/issuance/auto-issue.ts`; `lib/data/receipts.ts` (B2); `lib/http/receipts.ts` (D3); the batch page lists them with their links (E1); open: automatic issuance on confirmation (a worker) |
| REQ-CON-12 | ✅ | 3.3.6.2 | PROOF §5d (F3: console links opened on the page, live regtest, VALID) and PROOF §2c: `packages/verify/r/` reads the fragment, and the Chrome e2e shows no request, header or storage carries the receipt `[R68]`; `04` SCR-10, FLOW-2 |
| REQ-CON-13 | ⬜ | 3.3.6.3 | `04` SCR-11, FLOW-3 |
| REQ-CON-14 | ⬜ | 3.3.6.3 | `05` §3 export columns `[R5]` `[R32]` |
| REQ-CON-15 | ⬜ | 3.3.6.4 | cut order item 2 (`11_plan.md` §2) |
| REQ-CON-16 | ⬜ | 3.3.6.4 | cut order item 2 |
| REQ-CON-17 | ✅ | 3.3.1.1 | `docs/THREAT_MODEL.md` custody modes; `04` SCR-5 notice; config validation (`apps/console/test/config.test.ts`); startup refusal through `next start` (`apps/console/test/app.e2e.test.ts`) |
| REQ-CON-18 | ⬜ | — | no leaf; post-hackathon roadmap (Won't for v0) |
| REQ-CON-19 | ⬜ | 3.3.5.7 | `[R10]` Konclave CSV, `[R12]` zecpay columns |
| REQ-CON-20 | ⬜ | 3.3.5.8 | `05` §1 `batches` `rate_sources_json`; cut item 4 |
| REQ-CON-21 | ⬜ | 3.3.5.9 | `05` §1 `rate_at_execution` + `submitting` preflight; `07` §2 |
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
| NFR-4 | ✅ | 3.4.2.1 | PROOF §2b timing (2026-09-22) at 9,166 and 15,478 bytes (flat, > 130× inside budget); the last 23 % to 20 KB not measured |
| NFR-5 | ✅ | 3.2.3.1 | wasm-pack build; CI wasm job |
| NFR-6 | ✅ | 3.4.2.1 | CI source guards (log-line rule) |
| NFR-7 | ✅ | 3.2.3.4 | node guard copy check; console with 3.3.6.2 |
| NFR-8 | ⬜ | 3.3.5.2 | batch rate fields (REQ-CON-4) |
| NFR-9 | ⬜ | 3.3.6.3 | exports test (REQ-CON-14) |
