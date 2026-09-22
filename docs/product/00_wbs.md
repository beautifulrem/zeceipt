# Work breakdown structure (four levels)

Legend: ✅ done · 🟡 partial · ⬜ not started · 👤 blocked on the user · ❌ dropped. Owner roles: PM (product), R (Rust), T (TypeScript), U (user). Evidence: file path, test name, commit, PROOF section, or `[Rn]` in `10_research_log.md`.

Numbering is `phase.workstream.task.subtask`. Every leaf is a level-4 item.

---

## 1. Research phase

### 1.1 Competition intelligence
#### 1.1.1 Rules, tracks, prizes, judging
- 1.1.1.1 ✅ PM — Rules PDF, FAQ, track pages digested; criteria and factors listed. Evidence: KB `01`–`08`, `[R1]`.
- 1.1.1.2 ✅ PM — Zcash track sponsor expectations (50–100 submissions, ZODL contact). `[R2]`.
- 1.1.1.3 ✅ PM — Submission form fields and video specs captured. KB `04_submission`, `[R1]`.
- 1.1.1.4 👤 ⬜ U — Submission window open date confirmed on Colosseum Discord/FAQ (assumed 2026-10-05).
#### 1.1.2 Past winners and current entrants
- 1.1.2.1 ✅ PM — 337 past winners profiled (180 deep, 157 honourable). KB `winners/`, `[R36]`.
- 1.1.2.2 ✅ PM — 36 current public repos profiled, 17 deep. KB `projects/`.
- 1.1.2.3 ✅ PM — 86 external hackathons / 167 projects library migrated. KB `other_hackathons/`.
- 1.1.2.4 🟡 T — Weekly rescan of new Zcash-track repos (done 2026-09-21 only; next 2026-09-28). `20` §17.11.
#### 1.1.3 Judges
- 1.1.3.1 ✅ PM — 21 judges profiled with X handles and inferred tracks. KB `19_judges`.
- 1.1.3.2 ✅ PM — Receipt-version Q&A per judge. KB `19_judges` §七.
- 1.1.3.3 ⬜ PM — Identify the ZODL-appointed Zcash judge once announced (watch forum/Discord).
- 1.1.3.4 ⬜ PM — Prepare a one-page "why not Arcium / Solana audit keys" comparison for the Arcium judges.

### 1.2 Domain and technology research
#### 1.2.1 Zcash protocol state
- 1.2.1.1 ✅ R — Ironwood/NU6.3 status, Orchard sealed, migration progress. `[R20]`.
- 1.2.1.2 ✅ R — NU7 timeline (2026-11-05 target; ZSA deferred). KB `21` §一.
- 1.2.1.3 ✅ R — ZIP 311/303/304/310/316/321/324 read; ZIP 311 input requirement understood. `[R7]`.
- 1.2.1.4 ✅ R — Ironwood note-encryption domain and key hierarchy confirmed in crate source. `[R21]`.
#### 1.2.2 Tooling and wallets
- 1.2.2.1 ✅ R — Zallet RPC status and open bugs. `[R19]`.
- 1.2.2.2 ✅ R — Zkool GraphQL surface (multi-recipient memo pay). `[R18]`.
- 1.2.2.3 ✅ R — Zodl multi-recipient ZIP-321 fail-closed. `[R17]`.
- 1.2.2.4 ✅ R — lightwalletd/Zaino RPCs and public endpoints. `[R34]`.
#### 1.2.3 Adjacent ecosystems and mature products
- 1.2.3.1 ✅ PM — Monero prove-payment UX. `[R31]`.
- 1.2.3.2 ✅ PM — Solana confidential balances auditor model. KB `21` §四.
- 1.2.3.3 ✅ PM — Request Finance objects, statuses, webhooks, pricing. `[R27]`.
- 1.2.3.4 ✅ PM — Toku, Rise, Bitwage pricing and deliverables. `[R28]`–`[R30]`.
#### 1.2.4 Accounting and tax formats
- 1.2.4.1 ✅ PM — OpenZcash row model and methodology. `[R5]`.
- 1.2.4.2 ✅ PM — QuickBooks Online / Xero CSV import specs. `[R32]`.
- 1.2.4.3 ✅ PM — IRS FMV-at-receipt rules and 2026 1099-NEC threshold. `[R25]` `[R26]`.
- 1.2.4.4 ⬜ PM — Non-US (EU/UK) payer record requirements for crypto payouts (out of MVP scope; note only).

### 1.3 Demand and users
#### 1.3.1 Evidence of demand
- 1.3.1.1 ✅ PM — Forum thread on viewing keys for accounting. `[R3]`.
- 1.3.1.2 ✅ PM — FPF/ZCG disbursement volumes and manual process. `[R4]` `[R6]`.
- 1.3.1.3 ✅ PM — ZCG #437 receipts SDK application as demand signal. `[R8]`.
- 1.3.1.4 ✅ PM — Konclave live payroll user (Zcash Brazil). `[R10]`.
#### 1.3.2 Personas and JTBD
- 1.3.2.1 ✅ PM — Six personas with jobs and evidence. `02_personas_jtbd.md`.
- 1.3.2.2 ✅ PM — Pilot candidates ranked by reachability. `08_gtm_pricing.md` §3.
- 1.3.2.3 ⬜ PM — Two structured conversations with pilot candidates (after forum post, week of 2026-09-28).
- 1.3.2.4 ⬜ PM — Recipient-side survey of 5 contributors on "what would you do with a receipt" (week of 2026-09-28).

### 1.4 Competitive analysis
#### 1.4.1 Direct and adjacent competitors
- 1.4.1.1 ✅ PM — ZecHub 3.0 overlaps enumerated (ZBooks, Konclave, Rime, Glasspane, ZBounty, ZPayroll, Zink, SAVANNA, ZecLedger). `[R9]`.
- 1.4.1.2 ✅ PM — In-window CWF entrants (Zenvelope, zechledger, veil402, ShieldStream). `[R15]` `[R16]`.
- 1.4.1.3 ✅ PM — Dead/dormant products (Zwage, zecpay, Glasspane). `[R12]`–`[R14]`.
- 1.4.1.4 ✅ PM — Feature-level matrix. `03_market_competition.md` §3.
#### 1.4.2 Positioning
- 1.4.2.1 ✅ PM — Three-layer map (execution / finance-ops / disclosure). KB `20` §五.
- 1.4.2.2 ✅ PM — Honest ZIP 311 scoping ("outputs half"). `spec/receipt-v0.md` §1.
- 1.4.2.3 ✅ PM — Prior-art disclosure file. `docs/PRIOR_ART.md`.
- 1.4.2.4 ✅ PM — Independent red-team and alternatives review, verdict adopted. KB `20` §十六.

---

## 2. Product definition phase

### 2.1 Problem and value
#### 2.1.1 Problem statement
- 2.1.1.1 ✅ PM — Problem statement written and scored. KB `20` §二, §十七.
- 2.1.1.2 ✅ PM — "Why now" (Ironwood, ZODL/Zallet stack, AMLR 2027). KB `20` §二.
- 2.1.1.3 ✅ PM — Non-goals listed. `01_requirements.md` §0.
- 2.1.1.4 ✅ PM — One-line pitch: "Private outside, provable per payment." `README.md`.
#### 2.1.2 Value proposition and pricing
- 2.1.2.1 ✅ PM — Value prop per persona. `02_personas_jtbd.md`.
- 2.1.2.2 ✅ PM — Pricing tiers benchmarked against Request Finance/Rise/Bitwage/Toku. `08_gtm_pricing.md` §4.
- 2.1.2.3 ✅ PM — Top-down TAM/SAM/SOM with sources. `03_market_competition.md` §1.
- 2.1.2.4 ⬜ PM — Willingness-to-pay check with two pilot orgs (after 1.3.2.3).

### 2.2 Requirements
#### 2.2.1 Functional requirements per module
- 2.2.1.1 ✅ PM — Receipt core (REQ-CORE-*). `01_requirements.md` §1.
- 2.2.1.2 ✅ PM — CLI (REQ-CLI-*). §2.
- 2.2.1.3 ✅ PM — Browser verifier and SDK (REQ-WEB-*). §3.
- 2.2.1.4 ✅ PM — Payout console (REQ-CON-*), Solana attestation (REQ-SOL-*), integrations (REQ-INT-*). §4–§6.
#### 2.2.2 Non-functional requirements
- 2.2.2.1 ✅ PM — Security boundaries (no spending keys, fail-closed). §7.
- 2.2.2.2 ✅ PM — Privacy (per-output disclosure, verifier privacy). §7.
- 2.2.2.3 ✅ PM — Reliability (endpoint failover, pending vs invalid). §7.
- 2.2.2.4 ✅ PM — Performance targets (verify < 1 s in browser, issue < 5 s per tx). §7.
#### 2.2.3 Traceability
- 2.2.3.1 ✅ PM — Implemented requirements linked to tests/PROOF. `01_requirements.md` columns.
- 2.2.3.2 ✅ PM — Open requirements linked to WBS items. same.
- 2.2.3.3 ✅ T — Consistency checker script. `scripts/check_product_docs.py`.
- 2.2.3.4 ✅ PM — Requirements reviewed by independent agent (this task's AC8).

### 2.3 UX and data
#### 2.3.1 User flows
- 2.3.1.1 ✅ PM — Issuer batch flow. `04_ux_flows.md` FLOW-1.
- 2.3.1.2 ✅ PM — Recipient receipt flow. FLOW-2.
- 2.3.1.3 ✅ PM — Auditor pack flow. FLOW-3.
- 2.3.1.4 ✅ PM — Integrator and public-ledger flows. FLOW-4/5.
#### 2.3.2 Screens and copy
- 2.3.2.1 ✅ PM — Screen inventory with states. `04_ux_flows.md` §3.
- 2.3.2.2 ✅ PM — Proves / does-not-prove copy fixed. `spec/receipt-v0.md` §4, demo page.
- 2.3.2.3 ✅ PM — Error taxonomy mapped to UI messages. `04_ux_flows.md` §4.
- 2.3.2.4 ⬜ T — Visual design (wireframes) for the console (after REQ-CON approval).
#### 2.3.3 Data model and APIs
- 2.3.3.1 ✅ PM — Console entities and invariants. `05_data_model_api.md` §1.
- 2.3.3.2 ✅ PM — Execution-backend adapter contract (Zkool/Zallet/ZIP-321). §2.
- 2.3.3.3 ✅ PM — Export formats: OpenZcash, QuickBooks, Xero. §3.
- 2.3.3.4 ✅ PM — Receipt/pack/well-known JSON contracts. §4.

### 2.4 Risk, compliance, plan
#### 2.4.1 Risk register
- 2.4.1.1 ✅ PM — Technical risks. `06_risk_register.md`.
- 2.4.1.2 ✅ PM — Market/competition risks. same.
- 2.4.1.3 ✅ PM — Regulatory risks. same.
- 2.4.1.4 ✅ PM — Schedule risks and stop-loss. same; KB `20` §17.14.
#### 2.4.2 Compliance and tax
- 2.4.2.1 ✅ PM — What the product records for 1099-NEC/W-2. `07_compliance_tax.md`.
- 2.4.2.2 ✅ PM — FMV source and timestamp policy. same.
- 2.4.2.3 ✅ PM — EU AMLR positioning. same.
- 2.4.2.4 ✅ PM — Data retention and privacy commitments. same.
#### 2.4.3 Planning
- 2.4.3.1 ✅ PM — Day-by-day plan with person-days, cut order. KB `20` §17.14.
- 2.4.3.2 ✅ PM — Success metrics (countable). KB `20` §17.8.
- 2.4.3.3 👤 ⬜ U — Team roster and founder-market-fit lines.
- 2.4.3.4 👤 🟡 U — Product name confirmed (working name Zeceipt; npm/GitHub/.xyz/.io free).

---

## 3. Engineering phase

### 3.1 Foundations
#### 3.1.1 Repository and process
- 3.1.1.1 ✅ R — Cargo workspace, pinned crate set. `Cargo.toml`.
- 3.1.1.2 ✅ R — Trellis initialised; spec layer filled. `.trellis/spec/`.
- 3.1.1.3 ✅ R — CI workflow (Rust gates + wasm + node guard). `.github/workflows/ci.yml` (never run: no remote).
- 3.1.1.4 ✅ R — Pre-event state and prior-art disclosure. `docs/PRE_EVENT_STATE.md`, `docs/PRIOR_ART.md`.
#### 3.1.2 Receipt core (crate `zeceipt-core`)
- 3.1.2.1 ✅ R — v4/v5/v6 parsing, Ironwood enumeration. test `parses_mainnet_v6_fixture_and_enumerates_ironwood_actions`.
- 3.1.2.2 ✅ R — OCK derivation + recovery, Ironwood/Orchard/Sapling behind `PoolOps`. tests `*_round_trip_*`, `official_orchard_test_vectors_ock_and_recovery`.
- 3.1.2.3 ✅ R — issue/verify with fail-closed semantics. `tests/offline_e2e.rs`.
- 3.1.2.4 ✅ R — Regtest network support. `Network::Regtest`, PROOF §5.
#### 3.1.3 Envelope (crate `zeceipt-types`)
- 3.1.3.1 ✅ R — Envelope v0, canonical bytes covering every display-affecting field. `committed_test_vectors_match`.
- 3.1.3.2 ✅ R — ed25519 signing, challenge binding. `sign_and_verify`, `tamper_each_field_breaks_signature`.
- 3.1.3.3 ✅ R — URL form and audit pack. `url_round_trip_and_bare_payload`, `audit_pack_round_trip`.
- 3.1.3.4 ✅ R — Deterministic vectors driven by `Network::ALL`/`Pool::ALL`. `spec/test-vectors/receipt-v0.json`.

### 3.2 Interfaces
#### 3.2.1 CLI (`zeceipt`)
- 3.2.1.1 ✅ R — keygen/inspect/issue/verify/pack/verify-pack/find-ironwood. `crates/zeceipt-cli/tests/cli.rs`.
- 3.2.1.2 ✅ R — Exit codes 0/1/2/3 and failure stages. same.
- 3.2.1.3 ✅ R — Offline mode (`--raw-tx-file`, `--raw-tx-dir`). same.
- 3.2.1.4 ⬜ R — `--block-range` privacy mode and `--tor` endpoint option (REQ-CLI-7).
#### 3.2.2 lightwalletd client (`zeceipt-lwd`)
- 3.2.2.1 ✅ R — GetTransaction, GetLatestBlock, GetBlockRange scan; failover. PROOF §1.
- 3.2.2.2 ✅ R — http (regtest) vs https TLS handling. PROOF §5.
- 3.2.2.3 ✅ R — Status→NotFound mapping and height sentinels tested. lwd unit tests.
- 3.2.2.4 ⬜ R — Live integration test behind `--features live` (REQ-CLI-8).
#### 3.2.3 Browser verifier and npm package
- 3.2.3.1 ✅ R — wasm-bindgen exports `verify_receipt`, `parse_receipt`, `check_signature`, `version`. `crates/zeceipt-wasm`.
- 3.2.3.2 ✅ T — `@zeceipt/verify` wrapper with types; gRPC-web `fetchRawTx`. `packages/verify/src`.
- 3.2.3.3 ✅ T — Demo page verified in Chrome incl. tamper and XSS checks. PROOF §2b.
- 3.2.3.4 ✅ T — Committed pkg + node staleness guard in CI. `packages/verify/test/verify.mjs`.

### 3.3 Product surfaces (open)
#### 3.3.1 Payout console (child task `09-21-payout-console`)
- 3.3.1.1 ⬜ T — Data model + migrations (REQ-CON-1..3). `05_data_model_api.md`.
- 3.3.1.2 ⬜ T — Payables, batches, FX lock, two-person approval with HMAC (REQ-CON-4..7).
- 3.3.1.3 ⬜ T — Execution adapters: Zkool GraphQL primary, Zallet, per-recipient ZIP-321 (REQ-CON-8..10).
- 3.3.1.4 ⬜ T — Auto-issuance, receipt page, audit pack page, exports (REQ-CON-11..14).
#### 3.3.2 Solana attestation (child task `09-21-solana-attestation`)
- 3.3.2.1 ⬜ R — Anchor program: ed25519 precompile check + PDA row (REQ-SOL-1..2).
- 3.3.2.2 ⬜ T — Client that verifies then submits (REQ-SOL-3).
- 3.3.2.3 ⬜ R — Devnet deployment and PROOF entry (REQ-SOL-4).
- 3.3.2.4 ⬜ T — Fallback: 1Click ZEC→USDC leg measured (REQ-SOL-5).
#### 3.3.3 Integrations
- 3.3.3.1 ⬜ T — Konclave CSV (`label,address,value[,memo]`) → receipt issuance adapter (REQ-INT-1).
- 3.3.3.2 ⬜ T — OpenZcash-compatible export with `receipt_url` column (REQ-INT-2).
- 3.3.3.3 ⬜ R — Well-known issuer key file generator and verifier upgrade path (REQ-INT-3).
- 3.3.3.4 ⬜ R — Post format v0 to zips #387 and forum (REQ-INT-4).
#### 3.3.4 Open technical questions
- 3.3.4.1 ⬜ R — Why the internal-scope OVK did not open the regtest change output. PROOF §5 observation.
- 3.3.4.2 ⬜ R — Zkool `pay` behaviour on Ironwood mainnet with N memos (only regtest measured).
- 3.3.4.3 ⬜ R — Zaino `GetTransaction` completeness on public instances.
- 3.3.4.4 ⬜ R — NU7 (25 s blocks, v6 unchanged) re-test on testnet after 2026-10-06.

### 3.4 Evidence and quality
#### 3.4.1 Proof log
- 3.4.1.1 ✅ R — mainnet-read. PROOF §1.
- 3.4.1.2 ✅ R — synthetic (CLI + browser). PROOF §2/§2b.
- 3.4.1.3 ✅ R — regtest consensus-valid transaction. PROOF §5.
- 3.4.1.4 👤 ⬜ U — testnet public-chain transaction (faucet claim). PROOF §4/§6.
#### 3.4.2 Quality gates
- 3.4.2.1 ✅ R — 26 tests, clippy `-D warnings`, fmt. CI file.
- 3.4.2.2 ✅ R — Independent implementation review 100/100 (five rounds). the development journal.
- 3.4.2.3 ⬜ R — Security self-review checklist before submission (deps audit `cargo audit`, secrets scan).
- 3.4.2.4 ⬜ R — Reproducible wasm build note or CI artifact.

---

## 4. Launch and go-to-market phase

### 4.1 Publishing
#### 4.1.1 Repository and package
- 4.1.1.1 👤 ⬜ U — Create GitHub org/repo, push, enable CI.
- 4.1.1.2 👤 ⬜ U — Register `zeceipt.xyz`; host demo page and `/.well-known/zeceipt.json` example.
- 4.1.1.3 👤 ⬜ U — `npm publish @zeceipt/verify` after links resolve.
- 4.1.1.4 ⬜ R — Tag v0.1.0; README badges; release notes.
#### 4.1.2 Community and design test
- 4.1.2.1 ⬜ R — Post format v0 to zips #387 (planned 2026-09-27).
- 4.1.2.2 ⬜ PM — Forum post "Shielded payment receipts: looking for one pilot" (2026-09-24 plan).
- 4.1.2.3 👤 ⬜ U — Decide on contacting Konclave's author (default yes).
- 4.1.2.4 ⬜ PM — ZecHub Discord announcement with demo link.

### 4.2 Pilots and traction
#### 4.2.1 Pilot organisations
- 4.2.1.1 ⬜ PM — ZecHub DAO weekly bounties (target ≥ 3 receipts).
- 4.2.1.2 ⬜ PM — Zcash Brazil (Konclave user) receipts for their public ledger.
- 4.2.1.3 ⬜ PM — One ZCG grantee team.
- 4.2.1.4 ⬜ PM — OpenZcash "verified" column demo branch.
#### 4.2.2 Countable metrics
- 4.2.2.1 ⬜ PM — Receipts issued on public chains (target ≥ 15 by 2026-10-12).
- 4.2.2.2 ⬜ PM — npm/crate downloads (≥ 50).
- 4.2.2.3 ⬜ PM — Publicly posted third-party verifications (≥ 3).
- 4.2.2.4 ⬜ PM — Weekly X updates posted (2026-09-28, 2026-10-05).

---

## 5. Submission phase

### 5.1 Materials
#### 5.1.1 Videos
- 5.1.1.1 ⬜ PM — Pitch video ≤ 3 min (script KB `20` §16.6).
- 5.1.1.2 ⬜ PM — Technical demo 2–3 min (outline KB `20` §17.14).
- 5.1.1.3 ⬜ PM — Weekly update videos ×2.
- 5.1.1.4 ⬜ PM — Upload to YouTube (unlisted) and test links.
#### 5.1.2 Written
- 5.1.2.1 ✅ PM — README with proof, prior art, status. `README.md`.
- 5.1.2.2 ⬜ PM — Product description (English, ≤ 500 words) and GTM paragraph. `09_submission_checklist.md` §2.
- 5.1.2.3 👤 ⬜ U — Team members with background context; team location; logo.
- 5.1.2.4 ⬜ PM — Category choice (Payments & Remittance vs Developer Infrastructure) decided with rationale. `09_submission_checklist.md` §1.

### 5.2 Process
#### 5.2.1 Timeline
- 5.2.1.1 ⬜ PM — Initial upload on window-open day (assumed 2026-10-05).
- 5.2.1.2 ⬜ PM — Final videos by 2026-10-09; freeze 2026-10-10.
- 5.2.1.3 ⬜ PM — Final submission 2026-10-11 (one-day buffer).
- 5.2.1.4 ⬜ PM — Post-submission: keep shipping; interview prep (KB `19_judges`).
#### 5.2.2 Compliance with rules
- 5.2.2.1 ✅ PM — English-only content. All repo docs English.
- 5.2.2.2 ✅ PM — Pre-existing code disclosure. `docs/PRE_EVENT_STATE.md`.
- 5.2.2.3 ⬜ PM — Repository access for judges if private (plan: public).
- 5.2.2.4 ⬜ PM — Prize acceptance readiness (wallet for CASH, tax) — after results.

---

## Roll-up

| Phase | Leaves | ✅ | 🟡 | ⬜ | 👤 |
|---|---|---|---|---|---|
| 1 Research | 44 | 37 | 1 | 5 | 1 |
| 2 Product definition | 44 | 40 | 0 | 2 | 2 |
| 3 Engineering | 48 | 27 | 0 | 20 | 1 |
| 4 Launch/GTM | 16 | 0 | 0 | 12 | 4 |
| 5 Submission | 16 | 3 | 0 | 12 | 1 |
| **Total** | 168 | 107 | 1 | 51 | 9 |

Counts are maintained by `scripts/check_product_docs.py` (run it after editing this file).
