# Work breakdown structure (four levels)

Legend: ✅ done · 🟡 partial · ⬜ not started · 👤 blocked on the user · ❌ dropped. Owner roles: PM (product), R (Rust), T (TypeScript), U (user). Evidence: file path, test name, commit, PROOF section, or `[Rn]` in `10_research_log.md`.

Numbering is `phase.workstream.task.subtask`. Every leaf is a level-4 item.

---

## 1. Research phase

### 1.1 Competition intelligence
#### 1.1.1 Rules, tracks, prizes, judging
- 1.1.1.1 ✅ PM — Rules PDF, FAQ, track pages digested; criteria and factors listed. `09_submission_checklist.md` §6, `[R1]`.
- 1.1.1.2 ✅ PM — Zcash track sponsor expectations (50–100 submissions, ZODL contact). `[R2]`.
- 1.1.1.3 ✅ PM — Submission form fields and video specs captured. `09_submission_checklist.md` §1, `[R1]`.
- 1.1.1.4 👤 ⬜ U — Submission window open date confirmed on Colosseum Discord/FAQ (assumed 2026-10-05).
#### 1.1.2 Past winners and current entrants
- 1.1.2.1 ✅ PM — 337 past winners profiled (180 deep, 157 honourable); win patterns summarised. `[R42]` `[R36]` `[R22]`; `03_market_competition.md` §5.
- 1.1.2.2 ✅ PM — 36 current public repos profiled, 17 deep; overlaps listed. `[R42]` `[R9]` `[R15]` `[R16]`; `03_market_competition.md` §3.
- 1.1.2.3 ✅ PM — 86 external hackathons / 167 projects reviewed for win patterns. `[R42]` `[R36]`.
- 1.1.2.4 🟡 PM — Weekly rescan of new Zcash-track repos (done 2026-09-21 only; next 2026-09-28). `03_market_competition.md` §5.
#### 1.1.3 Judges
- 1.1.3.1 ✅ PM — 21 judges profiled with X handles and inferred tracks. `[R42]` `[R1]`; answer sheet `11_plan.md` §6.
- 1.1.3.2 ✅ PM — Receipt-version Q&A per judge. `11_plan.md` §6.
- 1.1.3.3 ⬜ PM — Identify the ZODL-appointed Zcash judge once announced (watch forum/Discord).
- 1.1.3.4 ⬜ PM — Prepare a one-page "why not Arcium / Solana audit keys" comparison for the Arcium judges.

### 1.2 Domain and technology research
#### 1.2.1 Zcash protocol state
- 1.2.1.1 ✅ R — Ironwood/NU6.3 status, Orchard sealed, migration progress. `[R20]`.
- 1.2.1.2 ✅ R — NU7 timeline (testnet 2026-10-06, mainnet target 2026-11-05; ZSA deferred). `[R20]`; `06_risk_register.md` RSK-14. Updated by ZIP 259 (2026-09-22): the testnet activation height is set on 10-05 and mainnet's on 10-20, and NU7 adds consensus branch `0x77190AD9` `[R121]`.
- 1.2.1.3 ✅ R — ZIP 311/303/304/310/316/321/324 read; ZIP 311 input requirement understood. `[R7]`.
- 1.2.1.4 ✅ R — Ironwood note-encryption domain and key hierarchy confirmed in crate source. `[R21]`.
#### 1.2.2 Tooling and wallets
- 1.2.2.1 ✅ R — Zallet RPC status and open bugs. `[R19]`.
- 1.2.2.2 ✅ R — Zkool GraphQL surface (multi-recipient memo pay). `[R18]`.
- 1.2.2.3 ✅ R — Zodl multi-recipient ZIP-321 fail-closed. `[R17]`.
- 1.2.2.4 ✅ R — lightwalletd/Zaino RPCs and public endpoints. `[R34]`.
#### 1.2.3 Adjacent ecosystems and mature products
- 1.2.3.1 ✅ PM — Monero prove-payment UX. `[R31]`.
- 1.2.3.2 ✅ PM — Solana confidential balances auditor model. `[R41]`; `03_market_competition.md` §3.
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
- 1.3.1.2 ✅ PM — FPF/ZCG disbursement volumes and processing cadence. `[R4]` `[R6]`.
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
- 1.4.2.1 ✅ PM — Three-layer map (execution / finance-ops / disclosure). `03_market_competition.md` §4.
- 1.4.2.2 ✅ PM — Honest ZIP 311 scoping ("outputs half"). `spec/receipt-v0.md` §1.
- 1.4.2.3 ✅ PM — Prior-art disclosure file. `docs/PRIOR_ART.md`.
- 1.4.2.4 ✅ PM — Independent red-team and alternatives review, verdict adopted. `11_plan.md` §7.

---

## 2. Product definition phase

### 2.1 Problem and value
#### 2.1.1 Problem statement
- 2.1.1.1 ✅ PM — Problem statement written. `02_personas_jtbd.md` §0.
- 2.1.1.2 ✅ PM — "Why now" (Ironwood, ZODL/Zallet stack, AMLR 2027). `02_personas_jtbd.md` §0.
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
- 2.2.3.4 ✅ PM — Requirements and the whole product package reviewed by an independent agent (this task's AC8) over 23 rounds: 65 → 83 → 87 → 90 → 92 → 94 → 95 → 96 → 95 → 96 → 96 → 97 → 97 → 97 → 95 → 96 → 97 → 97 → 97 → 97 → 98 → 99 → **100/100** (2026-09-22, commit `b86b183`). Reports and dispositions in `docs/product/reviews/round-1.md` … `round-23.md`.

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
- 2.4.1.4 ✅ PM — Schedule risks and stop-loss. `06_risk_register.md` RSK-6/7/18; `11_plan.md` §2–§3.
#### 2.4.2 Compliance and tax
- 2.4.2.1 ✅ PM — What the product records for 1099-NEC/W-2. `07_compliance_tax.md`.
- 2.4.2.2 ✅ PM — FMV source and timestamp policy. same.
- 2.4.2.3 ✅ PM — EU AMLR positioning. same.
- 2.4.2.4 ✅ PM — Data retention and privacy commitments. same.
#### 2.4.3 Planning
- 2.4.3.1 ✅ PM — Day-by-day plan with person-days, cut order. `11_plan.md` §1–§3.
- 2.4.3.2 ✅ PM — Success metrics (countable). `11_plan.md` §4.
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
#### 3.3.1 Payout console — foundations (child task `09-21-payout-console`; stack decided: Next.js App Router, TypeScript strict, Tailwind (set up with the first styled page, leaf 3.3.5.2), SQLite via better-sqlite3 + Drizzle (libSQL rejected 2026-09-23 on a durability defect `[R47]`); `.trellis/spec/frontend/index.md`)
- 3.3.1.1 ✅ T — Stack scaffold, config validation for custody mode (REQ-CON-17), `.env` schema, deploy target = Fly.io single node (SQLite volume). 0.5 pd, 2026-09-23 → 09-24. Done: slice C1 (Trellis `09-23-console-config`), the validated configuration `lib/config/env.ts` with REQ-CON-17's custody rules and `.env.example` `[R55]`; slice C2 (Trellis `09-23-console-app-boot`), the Next.js 16 app, whose `instrumentation.ts` boots once (config → keyring → database → migrations → wrap keys out of the environment) or exits 1, plus `GET /api/health` (IETF health+json; Fly.io checks expect 2xx) and a build-and-serve test in CI `[R56]` `[R57]`. Tailwind is set up in leaf 3.3.5.2 with the first styled page (slice E); the Fly.io files arrive with the deploy leaf.
- 3.3.1.2 ⬜ T — Auth/session (email magic link; SIWZ optional) and role matrix (REQ-CON-1). 0.5 pd, 2026-09-23 → 09-24.
- 3.3.1.3 ✅ R — Data model + migrations for orgs/members/recipients (REQ-CON-2) per `05_data_model_api.md` §1. 0.5 pd, 2026-09-23 → 09-24. Done so far (Trellis `09-23-store-sqlite`, walking-skeleton slice A): the database layer (`apps/console/db/`, Drizzle migrations) and the execution nonce tables with `SqliteIdempotencyStore`, passing the shared store contract `[R45]` `[R46]` `[R47]`; slice B1 (Trellis `09-23-batches-schema`): `batches` + `batch_items` with a freeze trigger once submitted and a batch repository `[R48]` `[R49]`; slice B2 (Trellis `09-23-receipts-sealed`): `receipts` with the OCK sealed at rest and key rotation `[R50]` `[R51]` `[R52]` `[R53]`; slice B3 (Trellis `09-23-batch-status`): the derived batch status `[R54]`; orgs and members: see the end. Recipients (slice H1, Trellis `09-23-recipients-store`): the `recipients` table (migration 0015) with the unified address validated for the console's network and duplicates flagged, not blocked; `POST/GET /api/recipients` and `GET /api/recipients/{id}` `[R75]` `[R76]`. The page `/recipients` (slice H2, Trellis `09-23-recipients-page`): the list with KYC, tax and settlement, duplicates flagged by the Orchard receiver they pay, and an add form with each error under its field (no JavaScript needed). Orgs and members are not built: they exist for sign-in and roles, dropped with 3.3.1.2 in the solo branch; the console is single-org by configuration (`ZECEIPT_ORG_ID`) and every table is scoped by `org_id`. Editing and archiving recipients are not built (not in REQ-CON-2's acceptance). Done 2026-09-25 (status audit, slice K1).
- 3.3.1.4 ✅ R — API surface: route handlers `/api/{recipients,payables,batches,approvals,receipts,exports}` writing `audit_log`; OpenAPI stub. 0.5 pd, 2026-09-23 → 09-24. Done so far (slice D1, Trellis `09-23-console-batch-routes`): the conventions (RFC 9457 problem+json, a loopback-Host and same-origin guard on every request (`proxy.ts` for pages, `guarded()` for API routes), one body ceiling, zatoshi as strings), `POST/GET /api/batches`, `GET /api/batches/{id}`, and the OpenAPI stub `docs/api/openapi.json` with a drift test `[R58]` `[R59]` `[R60]`. Slice D2 (Trellis `09-23-console-submit-routes`): `POST /api/batches/{id}/submit` (confirmation of the total, pay once per batch nonce, replays marked) and `GET /api/batches/{id}/status`, with every execution failure stating `payment` `[R61]`. Slice H1: `POST/GET /api/recipients`, `GET /api/recipients/{id}` `[R75]`. The route and Server Action conventions were re-checked against current Next.js 16.2.9, React and Drizzle documentation (context7) on 2026-09-25 `[R85]`. Slice H3: `POST/GET /api/payables`, `GET /api/payables/{id}` `[R78]`. Receipts (D3), approvals (I3) and the batch history (slice I4, Trellis `09-25-audit-trail`: `audit_log` written by triggers, `GET /api/batches/{id}/history` `[R89]`) are built. The trail of recipients and payables (slice I4b, Trellis `09-25-record-trail`: `record_log` by triggers, `GET /api/recipients/{id}/history` and `GET /api/payables/{id}/history` `[R91]`). Exports are dropped with 3.3.6.3. Review 100/100 (97 → 100; docs/product/reviews/record-trail-round-2.md), done 2026-09-25. Then (slice S3, Trellis `09-25-zkool-token`): the console authenticates to Zkool with a token scoped to its own account (Zkool listens on every interface, and without `--jwt-public-key-file` anyone could call `pay`); live on regtest, a request without a token is refused and the console pays with its token (PROOF §5e) `[R97]`. Then (slice S4b, Trellis `09-26-script-nonce`): pages run only their own scripts, with a per-response nonce and `'strict-dynamic'` on top of S4's directives `[R103]`. Then (slice S4c): pages load images, styles, fonts and connections only from the console, with its own 404 page `[R104]`.
#### 3.3.2 Solana attestation (child task `09-21-solana-attestation`)
- 3.3.2.1 ⬜ R — Anchor program: ed25519 precompile check + PDA row (REQ-SOL-1, REQ-SOL-2). 0.5 pd, 2026-10-01 → 10-03.
- 3.3.2.2 ⬜ T — Client that verifies then submits (REQ-SOL-3). 0.25 pd, 2026-09-29 → 09-30.
- 3.3.2.3 ⬜ R — Devnet deployment and PROOF entry (REQ-SOL-4). 0.25 pd, 2026-10-01 → 10-03.
- 3.3.2.4 ⬜ T — Fallback: 1Click ZEC→USDC leg measured (REQ-SOL-5). 0.5 pd, 2026-10-08 → 10-09.
#### 3.3.3 Integrations
- 3.3.3.1 ⬜ T — Konclave CSV (`label,address,value[,memo]`) → receipt issuance adapter (REQ-INT-1). 0.75 pd, 2026-09-29 → 09-30.
- 3.3.3.2 ✅ T — OpenZcash-compatible export with `receipt_url` column (REQ-INT-2). 0.75 pd, 2026-10-01 → 10-03. Done 2026-09-26 (slices X1, X2a, X2b, X2c): spec re-derived from OpenZcash's own export (R110); writer and formatters checked against OpenZcash's own code; the route `GET /api/batches/{id}/exports/openzcash` with its audit record, cross-site refusal and HEAD rule; the batch page's link with its disclosure, tested through `next start`.
- 3.3.3.3 ✅ R — Well-known issuer key file generator and verifier upgrade path (REQ-INT-3). 0.5 pd, 2026-10-01 → 10-03. Added back after the solo-branch drop (slices W1–W3). The design is redone as a domain-control binding (W1, spec §7, `[R101]`). The claim rule, the file format, the outcome logic, shared vectors, the `zeceipt well-known` generator and the console key-id rule are built (W2a). The CLI lookup (W2b), the verify package (W3a) and the receipt page's "Check with <domain>" (W3b, PROOF §2e) complete it.
- 3.3.3.4 ⬜ R — Post format v0 to zips #387 and forum (REQ-INT-4). 0.5 pd, 2026-09-27 → 09-28. Drafted 2026-09-26 (slice Z1, `docs/outreach/zips-387-comment.md`): an implementation report on the outputs half and an answer to ZIP 311's reason for requiring spend authority `[R102]`; posting it is the user's.
#### 3.3.4 Open technical questions
- 3.3.4.1 ✅ R — Is OVK scope a reliable change signal? No — wallets differ — Zkool encrypts change with the *external* OVK (our issuer opened it, PROOF §5b), zcash-devtool with a key the UFVK does not expose (still unopened by either scope). Consequence fixed the same day: change is now recognised by address ownership (issuer FVK, either scope), not by OVK scope; core test `zkool_batch_fixture_excludes_change_by_own_address`. Why devtool's change key differs is unresolved and deferred to post-submission (RSK-5). 0.25 pd, 2026-09-22.
- 3.3.4.2 ✅ R — Zkool `pay` with N recipients and N memos measured on regtest (PROOF §5b): one v6 transaction, 3 recipients + change in 4 Ironwood actions, 8.5 s to build, mined 19 s after `pay`, memo limit 512 bytes enforced client-side, each recipient recovers its memo; issuer must be restored with `useInternal: true` to see notes at the internal scope. Mainnet behaviour remains to be confirmed with the first funded batch (10-01, noted on 3.3.5.4). 0.25 pd, 2026-09-22.
- 3.3.4.3 ⬜ R — Zaino `GetTransaction` completeness on public instances. 0.25 pd, 2026-10-10 → 10-11 (documentation-only during the freeze).
- 3.3.4.4 ⬜ R — NU7 (25 s blocks, v6 unchanged) re-test on testnet after the 2026-10-06 activation. 0.25 pd, 2026-10-04 → 10-07 (run on 10-07). The outcome is already known (R121, slice U1a): the v6 format is unchanged, but NU7's consensus branch is refused by name until the Zcash crates are bumped (U1b spike, U1c on release); RSK-14.
- 3.3.4.5 ⬜ R — Spend-authority proof prototype (REQ-CORE-9, Should 8): rerandomized spend-auth signature over the receipt bytes via a wallet-side signer; first item in the cut order. 2 pd, 2026-10-04 → 10-07.
#### 3.3.5 Payout console — payables, batches, execution
- 3.3.5.1 ✅ R — Payables model + manual entry with validation report and linkability warning (REQ-CON-3, REQ-CON-6). 0.25 pd, 2026-09-23 → 09-24. Done so far (slice E2b, Trellis `09-23-console-draft-form`): manual entry of a batch's lines at `/batches/new` (a line table that works without JavaScript; amounts in ZEC converted exactly; every validation problem next to its line; values kept after an error) through the same handler as `POST /api/batches` `[R64]`; lines keyed by stable ids with controlled inputs, covered by a browser e2e in Chrome `[R65]`. Payables (slice H3, Trellis `09-23-payables-store`): the `payables` table (migration 0016) and `POST/GET /api/payables`, `GET /api/payables/{id}`: whole US cents, a reference unique per org (the memo), an http(s) source link, the recipient the org's `[R78]`. The page `/payables` (slice H4, Trellis `09-23-payables-page`): the list with a kind filter and the add form, amounts in US dollars converted to cents exactly, errors under their fields `[R79]`. The linkability warning (slice H6, Trellis `09-25-linkability-warning`): on the recipients page, the chooser and the batch page before paying, and `linkability`/`disclosedBy` in the API; spec §9's wording, tested against the spec `[R84]`.
- 3.3.5.7 ✅ R — CSV import (REQ-CON-19): Konclave `label,address,value[,memo]` rows into a draft batch's lines, zecpay `name,wallet,amount,currency,payout_currency` rows into payables after a preview and a confirm (`05` §3.6). 0.25 pd, 2026-09-23 → 09-24. Done 2026-09-26: the Konclave import fills the draft form (slice I2); the zecpay import previews, then writes the previewed plan in one transaction (slices I3a, I3b).
- 3.3.5.2 ✅ T — Batches with single-source rate lock and state machine (REQ-CON-4, REQ-CON-10, NFR-8: stores the FMV source/rate/timestamp). Includes the console's Tailwind setup with this first styled page (slice E; moved from 3.3.1.1). Done so far (slice E1, Trellis `09-23-console-batch-pages`): Tailwind v4 and ESLint (CI), and the read-only pages `/` and `/batches/{id}`, whose wording follows the derived status and never says confirmed without a confirmed payment (Konclave `settlement.ts`), with the payment mode shown apart from the lifecycle `[R62]`; slice E2 (Trellis `09-23-console-batch-actions`): the page actions, Pay (the button names the total, which is posted as the confirmation) and Issue receipts, as Server Actions that call the same handlers as the API and show the API's answer in plain words `[R63]`. Slice E3 (Trellis `09-23-console-regtest-http`): the whole path through the built app on the live regtest chain, from form to verified receipts (PROOF §5d). The rate lock and grouping payables are below. Voiding a draft (slices H5c, H5d) is below. 0.5 pd, 2026-09-25 → 09-26. Done 2026-09-25: REQ-CON-4, REQ-CON-10 and NFR-8 are met (status audit, slice K1). Tables spaced as GOV.UK's table (slice M1, Trellis `09-25-table-spacing`) `[R93]`; the batch table fits 1280 px with UUID payable ids abridged to their tails and values unbroken (slice M1b) `[R94]`; each quote records its host, and the page names Kraken only for Kraken (slice N1).
  Rate groundwork (slice G1a, Trellis `09-23-rate-quote-client`): `lib/rates/kraken.ts` fetches Kraken's public ticker for `XZECZUSD`. It keeps bid, ask and last exactly, uses the bid as the rate (BTCPay's choice), and records our clock's time. Any failure throws `RateUnavailableError`: no cache, no default, unlike zecpay's silent 35.0 `[R70]`. Storing quotes (slice G1b, Trellis `09-23-rate-quotes-store`): `rate_quotes`, an append-only history per batch (lock and execution; no lock once frozen; triggers 0012) with `recordQuote`, `currentLock` and `listQuotes` `[R71]`. The lock API (slice G1c1, Trellis `09-23-rate-lock-api`): `POST /api/batches/{id}/rate-lock` (201 with the lock; 409 `batch_frozen`; 502 `rate_unavailable` with a fixed reason, and nothing locked), and `rateLock` on `GET /api/batches/{id}`. The source is `ZECEIPT_RATE_URL` (Kraken by default) `[R72]`. The page (slice G1c2, Trellis `09-23-rate-lock-page`): a Lock/Re-lock rate form (the API's handler, hidden once submitted), the rate with its exact bid, source and time, and a USD-at-lock column. It is exact with bigints, and the total is rounded once (04 principle 4). ZEC amounts show a fixed 8 decimals with the last five lighter, as Zkool does (slice G1d `[R73]`). Grouping payables (slice H5a, Trellis `09-23-batch-from-payables`): `POST /api/batches/from-payables` quotes once and, in one transaction, writes a line per payable (its recipient's name and address, its reference as the memo, its cents, zat = floor(cents × 10^8 / (100 × rate)) exact) and records that quote as the batch's only lock; the rate is then fixed (409 `rate_fixed`; BTCPay fixes an approved payout's rate); a payable is in at most one batch (a partial unique index); triggers tie each line to its payable's facts `[R80]`. The page (slice H5b, Trellis `09-23-payables-batch-page`): `/batches/from-payables` offers the free payables as checkboxes and makes the batch at today's rate; the payables page shows each payable's batch `[R81]`. The state machine (REQ-CON-10; slice I1, Trellis `09-25-state-machine-evidence`): B3's derived states mapped to the requirement in 05, with the configured confirmations tested over HTTP. Voiding (slice H5c, Trellis `09-25-void-draft`): `POST /api/batches/{id}/void` while nothing can have been sent; the void is final and kept, the batch takes nothing more, and its memos and payables are released (memo claims, migration 0019), so a batch whose rate moved is recovered by voiding it and making a new batch from its payables at today's rate `[R82]`. The page (slice H5d, Trellis `09-25-void-page`): a "Void this draft…" link and a confirmation page with a warning-styled button; a voided batch is read-only `[R83]`.
- 3.3.5.8 ⬜ T — Second rate source and deviation guard (> 3% blocks until re-quote) (REQ-CON-20). 0.5 pd, 2026-09-25 → 09-26.
- 3.3.5.9 ✅ T — Lock-vs-execution guard: re-quote at execution, store `rate_at_execution`, block `submitting` on a > 3% move; test with a mocked feed (REQ-CON-21). 0.25 pd, 2026-09-25 → 09-26. Done so far (slice G2a, Trellis `09-23-rate-drift-check`): the exact drift check `rateDrift` and `ZECEIPT_RATE_MAX_DRIFT_BPS` (default 300; no age expiry, `[R74]`). Then (slice G2b1, Trellis `09-23-submit-rate-guard`; fixed in review round 1): before every attempt that will pay, a lock is required, the rate is re-quoted and the execution quote stored, and a move beyond the threshold refuses until re-locked. That covers a fresh batch, a retry after a refusal, and a re-send proven unminable. Every refusal sends nothing, a refused batch can be re-locked (migration 0014), and a path that may already have paid is never re-judged. On the page (slice G2b2, Trellis `09-23-pay-needs-lock-page`): Pay is offered only once the batch is locked. A refusal is explained in plain words ("Rate moved: ZEC/USD moved 5.00% since the lock (1600.00 → 1680.00 USD per ZEC); at most 3.00% is allowed. Re-lock the rate, approve the batch again, then pay. This request sent nothing."; "approve the batch again" since slice I3), and the refused batch keeps its Re-lock form.
- 3.3.5.3 ✅ T — Approval bound by HMAC; edits reset approvals (REQ-CON-5). 0.5 pd, 2026-09-25 → 09-26. Built (slice I3, Trellis `09-25-approval`) with one approver: `POST /api/batches/{id}/approve` records an HMAC over the lines, the lock and the paying account; a re-lock or any change to a line invalidates it; every attempt that will pay requires one; the page's Approve button before Pay `[R87]`. The second, distinct approver was split out with sign-in (3.3.1.2). Review 100/100 (99 → 100; docs/product/reviews/approval-round-2.md), done 2026-09-25.
- 3.3.5.4 ✅ R — Zkool GraphQL adapter incl. nonce idempotency, regtest batch of 3 (REQ-CON-7). Backend proven 2026-09-22 (PROOF §5b); console library `ZkoolBackend` with an exclusive per-nonce intent store, reconciliation and status done 2026-09-23 (PROOF §5c; `apps/console/lib/execution/`; Trellis task `09-23-execution-adapter`). 1 pd, 2026-09-25 → 09-26.
- 3.3.5.5 ⬜ R — Zallet `z_sendmany` adapter with unknown-outcome handling (REQ-CON-8; cuttable). 0.5 pd, 2026-10-08 → 10-09.
- 3.3.5.6 ⬜ R — Per-recipient ZIP-321 URI/QR adapter, non-custodial (REQ-CON-9). 0.5 pd, 2026-10-01 → 10-03.
#### 3.3.6 Payout console — receipts, pages, exports
- 3.3.6.1 ✅ R — Auto-issuance after N confirmations via `zeceipt-core` (wasm or sidecar), idempotent per (txid, index) (REQ-CON-11, NFR-3). Library `autoIssue` done 2026-09-23 (confirmation gate, `zeceipt issue --only-to` allow-list, per-item cross-check, verification; PROOF §5c); storing receipts sealed at rest with the unique (org, txid, pool, index) key: slice B2; over HTTP: slice D3 (Trellis `09-23-console-receipt-routes`), where the batch's derived status decides, below the threshold is 202 waiting (pending, not invalid), and an issued batch returns its stored receipts without re-running the CLI; console receipts carry no challenge (bearer links). The batch page lists receipts and offers Issue once confirmed (E1/E2), shown on the live chain in PROOF §5d. Open: a background worker (issuance without a click). 1 pd, 2026-09-27 → 09-28. Automatic issuance (slice I2, Trellis `09-25-receipt-worker`): a worker started from `instrumentation.ts` issues receipts for confirmed batches every `ZECEIPT_AUTO_RECEIPTS_SECONDS` through the same idempotent handler `[R86]`; review 100/100 (docs/product/reviews/receipt-worker-round-1.md), done 2026-09-25. Then (slice I2b, Trellis `09-25-receipt-worker-backoff`, from that review's optional): a batch that keeps failing is retried after 1, 2, 4 … 32 passes and its failure logged once per code `[R88]`.
- 3.3.6.2 ✅ T — Public receipt page `/r#<payload>` (payload in the fragment, spec §2.1; link format changed in slice F1 `[R66]`) with three-part outcome and challenge input (REQ-CON-12, REQ-WEB-7). 1 pd, 2026-09-27 → 09-28. Done 2026-09-23 (slices F2a and F2b, Trellis `09-23-verify-chain-status`, `09-23-public-receipt-page`):
  - a static page at `packages/verify/r/` that reads the link's fragment and verifies in the browser;
  - the summary shows before any request; the transaction comes from a named public node or a file; a challenge input appears only for bound receipts;
  - the three-part outcome, with chain status mined/mempool/fork `[R67]`;
  - a strict CSP and no Referer;
  - a Chrome e2e proving no request, header or storage carries the receipt (PROOF §2c) `[R68]`.

  Then (slice F3, Trellis `09-23-console-receipt-host`): the console's links point at the page's site (`ZECEIPT_RECEIPT_HOST` → `zeceipt issue --host`, GitLab's `external_url` pattern `[R69]`). Live on regtest, each console link opens on the page in Chrome as VALID with its item's memo and value, and the page's host never sees a receipt (PROOF §5d). Then (slice S2, Trellis `09-25-link-host`): no default host anywhere, since the page a host serves reads the fragment and `zeceipt.xyz` is not ours yet. The console refuses to start without `ZECEIPT_RECEIPT_HOST`; `zeceipt issue` without `--host` issues with `"url": null`; the examples and vectors use the reserved `receipts.example` `[R96]`.
- 3.3.6.3 ⬜ R — Audit-pack page + JSON; exports OpenZcash/QBO/Xero/1099 totals with column tests (REQ-CON-13, REQ-CON-14, NFR-9). 1.5 pd, 2026-09-29 → 09-30.
- 3.3.6.4 ⬜ T — Notifications and UFVK reconciliation view (REQ-CON-15, REQ-CON-16; cut order item 2). 1 pd, 2026-10-08 → 10-09 (only if restored).

### 3.4 Evidence and quality
#### 3.4.1 Proof log
- 3.4.1.1 ✅ R — mainnet-read. PROOF §1.
- 3.4.1.2 ✅ R — synthetic (CLI + browser). PROOF §2/§2b.
- 3.4.1.3 ✅ R — regtest consensus-valid transaction. PROOF §5. The console on the same chain: §5c–§5g. Slice P2, Trellis `09-26-proof-payables-live`, added the payables path: USD payables, a batch at Kraken's live rate, and receipts issued by the worker on its own (§5g).
- 3.4.1.4 👤 ⬜ U — testnet public-chain transaction (the faucet claim is the user's decision: fauzec's API has no human gate "for now", while its web form and jinolabs's have one `[R126]`). PROOF §4/§6.
- 3.4.1.5 👤 ⬜ U — Fund the issuing wallet: testnet faucet + mainnet ZEC for ≥ 15 receipts (≈ 0.02 ZEC incl. fees), by 2026-09-26; without it the headline metric (`11_plan.md` §4) cannot be met.
#### 3.4.2 Quality gates
- 3.4.2.1 ✅ R — 54 Rust tests + 459 TypeScript console tests (and 3 opt-in regtest e2e: the library, PROOF §5c; the app through HTTP, §5d; the payables path, §5g; the 26 build-and-serve tests, four of them in Chrome, run in CI with `ZECEIPT_APP_E2E=1 ZECEIPT_BROWSER_E2E=1`; the public receipt page's 13 Chrome tests, `packages/verify/test/page.e2e.mjs`, also run in CI), clippy `-D warnings`, fmt, grep guards (key-material flags, secrets in logs), demo copy check. `.github/workflows/ci.yml`, `packages/verify/test/verify.mjs`, `packages/verify/test/pack.mjs` (the npm tarball as published, slice R1b1).
- 3.4.2.2 ✅ R — Independent implementation review 100/100 (five rounds). the development journal.
- 3.4.2.3 🟡 R — Security self-review checklist before submission (deps audit `cargo audit`, secrets scan). 0.25 pd, 2026-10-08 → 10-09. First pass done early (slice J1, Trellis `09-25-security-review`, 2026-09-25): `scripts/security_review.sh` runs `cargo audit`, `npm audit` on both lockfiles, gitleaks on the history and the working tree, and the source guards, and exits 1 on any finding. The one real finding (esbuild 0.18.20 under drizzle-kit, GHSA-67mh-4wv8-2f99) is fixed by an npm override; every accepted finding is recorded with its reason (`docs/SECURITY_REVIEW.md`) `[R90]`. The leaf closes with the pre-submission rerun. The console's threat model (slice T1, Trellis `09-25-threat-model-console`): `docs/THREAT_MODEL.md` "The payout console", with a data-flow sketch, trust boundaries, assets, and fourteen threats by STRIDE, each with its control, evidence and residual. Its mapping found three gaps, fixed as S3 (the wallet reachable around the console), S4 (clickjacking) and S5 (a restored database paying twice) `[R100]`. A dry run passed on 2026-09-27 at fd62009 (slice S6, `docs/SECURITY_REVIEW.md` "Interim pass"); the formal rerun keeps its date.
- 3.4.2.4 ⬜ R — Reproducible wasm build note or CI artifact; if time allows, a synthetic 20 KB v6 fixture to measure NFR-4 at its stated bound. 0.25 pd, 2026-10-08 → 10-09. Slice X3a: the committed WASM carried the builder's local paths; `scripts/build_wasm.sh` remaps them, two builds from different checkouts are byte-identical on one toolchain, the package is rebuilt, and `verify.mjs` refuses a local path; the README states the toolchain and the hash `[R119]`. The release notes' provenance says so. Slice X3b: CI rebuilds it on Linux (`ubuntu-24.04`, slice X3c) with the pinned toolchain and the runner's clang 18, requires the wasm-bindgen outputs to match and the Linux build to pass `verify.mjs`, and reports the `.wasm` comparison; `scripts/build_wasm.sh --check` does the same locally `[R120]`. The Linux answer comes with the first CI run, after the push. The optional 20 KB measurement is done with a real transaction instead of a synthetic one (slice P3): a consensus-valid regtest batch of 21,790 bytes, verified in at most 4.2 ms in Chrome in that run, 5.9 ms in the reviewer's (`packages/verify/test/timing.mjs`).

---

## 4. Launch and go-to-market phase

### 4.1 Publishing
#### 4.1.1 Repository and package
- 4.1.1.1 👤 ⬜ U — Create GitHub org/repo, push, enable CI.
- 4.1.1.2 👤 ⬜ U — Register `zeceipt.xyz`; host demo page and `/.well-known/zeceipt.json` example. The receipt page needs `packages/verify/` as the site root, with `/r` redirected to `/r/` (README, "Receipt links"). Check it on the host, and add the page's CSP and `Referrer-Policy` as response headers there (a meta cannot carry `frame-ancestors`).
- 4.1.1.3 👤 ⬜ U — `npm publish @zeceipt/verify` after links resolve. The package is ready (slice R1b1): public access set, its own README, and `packages/verify/test/pack.mjs` installs the packed tarball offline and runs the README's Node example through it `[R115]`. The first version is published by hand (trusted publishing needs the package to exist), from an npm account with 2FA that owns the `zeceipt` scope, after `repository.url` matches the pushed repository; the steps are R1b2's procedure.
- 4.1.1.4 ⬜ R — Tag v0.1.0; README badges and a "For judges" section (where to start, commands, what runs where; winner lessons item 9); release notes. 0.25 pd, 2026-10-08 → 10-09. Added back in the solo branch (slice D10b): the section and notes in 09-27 → 09-30, the tag on 10-09. The "For judges" section exists (slice J2, `0ee3926`). Slice R1a: `CHANGELOG.md` in Keep a Changelog form, its first release under `Unreleased` until the tag `[R114]`; R1b: the release notes and the release procedure, with the badges once the repository has a URL; `scripts/check_release.py` (slice R1b3a, in CI) holds the nine version sources to the workspace's and, with `--tag`, the changelog to a dated section and a clean tree before the annotated tag `[R116]`; `docs/RELEASING.md` (slice R1b3b) is the procedure, step by step with who runs each `[R117]`; R1b4: the release notes, `docs/release/v0.1.0.md` (a summary, how to try it, the evidence, known limitations from the threat model and risk register, provenance) `[R118]`; R1c: the tag on 10-09.
#### 4.1.2 Community and design test
- 4.1.2.1 ⬜ R — Post format v0 to zips #387 and follow the thread (the post itself is 3.3.3.4; this is monitoring/replies). 0.25 pd, 2026-10-08 → 10-09.
- 4.1.2.2 🟡 PM — Forum post "Shielded payment receipts: looking for one pilot" (2026-09-24 plan). 0.5 pd, 2026-09-23 → 09-24. Drafted 2026-09-25 (slice L1, Trellis `09-25-forum-post-draft`): `docs/outreach/forum-pilot-post.md`, every claim tied to PROOF, links marked for after the push `[R92]`. Posting is the user's action, after the repository is public (4.1.1.1).
- 4.1.2.3 👤 ⬜ U — Decide on contacting Konclave's author (default yes).
- 4.1.2.4 ⬜ PM — ZecHub Discord announcement with demo link. 0.25 pd, 2026-09-27 → 09-28.

### 4.2 Pilots and traction
#### 4.2.1 Pilot organisations
- 4.2.1.1 ⬜ PM — ZecHub DAO weekly bounties (target ≥ 3 receipts). 0.5 pd, 2026-10-01 → 10-03.
- 4.2.1.2 ⬜ PM — Zcash Brazil (Konclave user) receipts for their public ledger. 0.5 pd, 2026-10-01 → 10-03.
- 4.2.1.3 ⬜ PM — One ZCG grantee team. 0.25 pd, 2026-10-08 → 10-09.
- 4.2.1.4 ⬜ PM — OpenZcash "verified" column demo branch (uses the export from 3.3.3.2). 0.25 pd, 2026-10-01 → 10-03.
#### 4.2.2 Countable metrics
- 4.2.2.1 ⬜ PM — Receipts issued on public chains (target ≥ 15 by 2026-10-12).
- 4.2.2.2 ⬜ PM — npm/crate downloads (≥ 50).
- 4.2.2.3 ⬜ PM — Publicly posted third-party verifications (≥ 3).
- 4.2.2.4 ⬜ PM — Weekly updates posted (most likely on the Arena dashboard, with X as an extra; slice V1) (2026-09-28, 2026-10-05).

---

## 5. Submission phase

### 5.1 Materials
#### 5.1.1 Videos
- 5.1.1.1 ⬜ PM — Pitch video ≤ 3 min (beat sheet `11_plan.md` §5). 0.75 pd, 2026-10-04 → 10-07. Pre-production done: the script `docs/outreach/pitch-video.md` (slices V2a, V2b), with every shot recorded on the live regtest chain by `apps/console/test/shots/demo-video.ts` (slices L2, V2c1, V2c2) and cued from frames; the team lines, narration, editing and upload remain (the user's).
- 5.1.1.2 ⬜ R — Technical demo 2–3 min (outline `11_plan.md` §5; recorded by the Rust engineer, who narrates the stack). 0.75 pd, 2026-10-04 → 10-07. Pre-production done: the script `docs/outreach/tech-demo-video.md` (slice V2d), with the terminal, custody and proof shots recorded (slice V2e) and the receipt page reused (slice L2); narration, editing and upload remain.
- 5.1.1.3 ⬜ PM — Weekly update video 1 (60 s, 09-28). 0.125 pd, 2026-09-27 → 09-28. Pre-production done: the script `docs/outreach/weekly-update-1.md` (slice V1), on the regtest footage of slice L2; recording and posting remain (the user's).
- 5.1.1.4 ⬜ PM — Upload to YouTube (unlisted) and test links. 0.25 pd, 2026-10-08 → 10-09.
- 5.1.1.5 ⬜ PM — Weekly update video 2 (60 s, 10-05). 0.125 pd, 2026-10-04 → 10-07. Pre-production done on 2026-09-28: the script `docs/outreach/weekly-update-2.md`, with rows that depend on the week, and its NU7 footage recorded by `apps/console/test/shots/nu7-refusal.ts` (slice WU2); applying those rows, recording and posting remain (the user's).
#### 5.1.2 Written
- 5.1.2.1 ✅ PM — README with proof, prior art, status. `README.md`.
- 5.1.2.2 🟡 PM — Product description (English, ≤ 500 words) and GTM paragraph. `09_submission_checklist.md` §2 and §2b. 0.5 pd, 2026-10-04 → 10-07. Drafted 2026-09-26 (slices D8 and D9); the placeholders (team, public-chain receipts, pilot, traction, post status) are filled at the 10-05 upload.
- 5.1.2.3 👤 ⬜ U — Team members with background context; team location.
- 5.1.2.4 ⬜ PM — Category choice (Payments & Remittance vs Developer Infrastructure) decided with rationale. Dropped with the solo branch, which forces Developer Infrastructure (`11_plan.md` §1.1, RSK-19); recorded in `09_submission_checklist.md` §1 (slice D8). 0.25 pd, 2026-10-04 → 10-07.
- 5.1.2.5 ⬜ PM — Logo / graphic: simple wordmark + receipt glyph (SVG) for the form. 0.25 pd, 2026-10-04 → 10-07.

### 5.2 Process
#### 5.2.1 Timeline
- 5.2.1.1 ⬜ PM — Initial upload on window-open day (assumed 2026-10-05). 0.25 pd, 2026-10-04 → 10-07.
- 5.2.1.2 ⬜ PM — Final videos by 2026-10-09; freeze and form re-check 2026-10-10. 0.25 pd, 2026-10-10 → 10-11.
- 5.2.1.3 ⬜ PM — Final submission 2026-10-11 (one-day buffer). 0.25 pd, 2026-10-10 → 10-11.
- 5.2.1.4 ⬜ PM — Post-submission: keep shipping; interview prep (`11_plan.md` §6).
#### 5.2.2 Compliance with rules
- 5.2.2.1 ✅ PM — English-only content. All repo docs English.
- 5.2.2.2 ✅ PM — Pre-existing code disclosure. `docs/PRE_EVENT_STATE.md`.
- 5.2.2.3 ⬜ PM — Repository access for judges if private (plan: public).
- 5.2.2.4 ⬜ PM — Prize acceptance readiness (wallet for CASH, tax) — after results.

---

## Asks of the user (all 👤 leaves, plus the user's part of PM leaves that §8 marks in bold, by due date)

Re-dated 2026-09-26 from `11_plan.md` §8 (the solo schedule): the asks due 09-22 → 09-26 had passed unanswered, and each new date is the one §8 gives.

| Due | Leaf | Ask | Why it blocks |
|---|---|---|---|
| 2026-09-28 | 2.4.3.4 | Confirm the product name (default: Zeceipt) | README, npm scope, domain |
| 2026-09-28 | 4.1.1.1 | Create the GitHub org/repo, push, enable CI | CI has never run; judges need a public URL; dead links in README/package.json; the forum and zips #387 drafts wait on it |
| 2026-09-28 | 5.1.1.3 | Record and post weekly update 1 (60 s; script and footage ready; most likely on the Arena dashboard, inferred from `isCurrentWeekUpdateSubmitted` and needing the project registered, with X tagging @colosseum as an extra) — a PM leaf whose recording and posting are the user's (`11_plan.md` §8); 4.2.2.4 counts the posts | the officially "strongly recommend"-ed weekly update; fallback: by 09-30 or skipped |
| 2026-09-30 | 3.4.1.4 | Claim testnet TAZ from a faucet: the user's decision (fauzec's API has no human gate "for now"; its web form and jinolabs's have one; PROOF §4 `[R126]`) | first public-chain receipt (PROOF §6) |
| 2026-09-30 | 3.4.1.5 | Fund the issuing wallet with mainnet ZEC (≈ 0.02 ZEC) | public-chain receipts (solo target ≥ 3), which must land by 10-03, before the videos |
| 2026-10-01 | 4.1.1.2 | Register `zeceipt.xyz`; host demo page and well-known example | receipt links in videos |
| 2026-10-01 | 4.1.2.3 | Decide whether to contact Konclave's author (default: yes). The adapter was dropped with the solo branch (`11_plan.md` §1.1), so this is now only a pilot channel | a second pilot candidate |
| 2026-10-03 | 1.1.1.4 | Confirm the submission window open date (Colosseum Discord/FAQ); inferred 2026-10-05 11:00 to 10-06 11:00 UTC `[R106]` | sets the initial-upload day (5.2.1.1) |
| 2026-10-03 | 2.4.3.3 | Team roster and two founder-market-fit sentences | pitch video (recorded from 10-04), submission form |
| 2026-10-05 | 5.1.1.5 | Record and post weekly update 2 (60 s; script and footage ready) — a PM leaf whose recording and posting are the user's (`11_plan.md` §8) | as above; fallback: by 10-07 or skipped |
| 2026-10-09 | 5.1.2.3 | Team backgrounds and location for the form | submission form fields |
| 2026-10-10 | 4.1.1.3 | `npm publish @zeceipt/verify` — the day after the security review rerun (3.4.2.3) completes on 10-09, which is also the day the v0.1.0 tag (4.1.1.4, restored by slice D10b) is cut; a release action, allowed during the freeze | REQ-WEB-8; integrator story; irreversible, so it follows the audit by a full day |

## Roll-up

| Phase | Leaves | ✅ | 🟡 | ⬜ | 👤 |
|---|---|---|---|---|---|
| 1 Research | 44 | 37 | 1 | 5 | 1 |
| 2 Product definition | 44 | 40 | 0 | 2 | 2 |
| 3 Engineering | 63 | 42 | 1 | 18 | 2 |
| 4 Launch/GTM | 16 | 0 | 1 | 11 | 4 |
| 5 Submission | 18 | 3 | 1 | 13 | 1 |
| **Total** | 185 | 122 | 4 | 49 | 10 |

Counts are maintained by `scripts/check_product_docs.py` (run it after editing this file).
