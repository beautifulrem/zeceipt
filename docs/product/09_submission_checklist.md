# Colosseum submission checklist

Source for fields and rules: `[R1]` (form fields captured 2026-09-17 from the FAQ; re-check the live form on the day the window is confirmed, WBS 1.1.1.4). Deadline 2026-10-12 23:59 PT; window assumed to open ~2026-10-05 (confirm). One submission per team; all content in English; misrepresenting development history or failing to disclose pre-existing code disqualifies `[R1]`.

## 1. Form fields

| Field | Content / decision | Status |
|---|---|---|
| Product name | Zeceipt (confirm) | 👤 |
| Description | ≤ 500 words; draft in §2 (≈ 450 words) | 🟡 |
| Blockchains and tools integrated | Zcash (Ironwood, Orchard, Sapling; lightwalletd/Zaino gRPC; Zkool GraphQL); Solana (attestation program, devnet); NEAR Intents 1Click (optional). Solana is dropped entirely if the solo branch activates (`11_plan.md` §1.1, RSK-19), which forfeits accelerator eligibility `[R1]`; re-check this row on 2026-09-24. At the 10-05 initial upload the field reads "Solana: devnet attestation program (program id + signature if deployed by 10-03, otherwise 'in progress'); NEAR Intents 1Click leg pending"; finalised at the 10-11 submission | ⬜ finalise after REQ-SOL / 2026-09-24 / 10-05 draft |
| Track | Zcash | ✅ |
| Category | **Payments & Remittance** (primary): receipts are a payments artefact and the console pays. Forced to **Developer Infrastructure** if the solo branch activates (`11_plan.md` §1.1, RSK-19, decision 2026-09-24) because that branch ships a minimal console; otherwise decided 2026-10-03 at the cut review (Developer Infrastructure if the console is cut) | ⬜ 2026-09-24 / 2026-10-03 |
| Team members with background | names, roles, 2-line bios | 👤 |
| Team location / country | | 👤 |
| Logo / graphic | simple wordmark + receipt glyph (SVG); team-made (PM, WBS 5.1.2.5, 0.25 pd, 2026-10-04 → 10-07) | ⬜ |
| GitHub repository | public URL (open source encouraged; private allowed with judge access) | 👤 push |
| Presentation (pitch) video | ≤ 3 min, YouTube unlisted | ⬜ |
| Product demo video | ≤ 3 min technical, YouTube unlisted | ⬜ |
| Go-to-market | paragraph from `08_gtm_pricing.md` §1–§2 | ⬜ |
| Live demo / website URL | `zeceipt.xyz` demo page (or GitHub Pages fallback) — field not in the 2026-09-17 capture; prepare anyway | ⬜ |
| X / social handle | team handle for weekly updates — not in the capture; prepare anyway | 👤 |
| AI-assistance disclosure | if the form asks: AI-assisted coding and research were used; all cryptography comes from upstream crates; disclose plainly | ⬜ |
| isUniversityProject / isSolanaMobile | no / no | ✅ |

## 2. Description draft (≈ 450 words, English)

**Problem.** Organisations that pay contributors in shielded Zcash cannot prove a single payment. Today the only options are a viewing key, which exposes every payment the wallet ever made, or a spreadsheet the auditor has to trust. Public grant ledgers such as OpenZcash mirror 1,015 disbursement rows and $23M in payouts, and not one row is verifiable against the chain.

**What Zeceipt does.** Every output an organisation pays becomes a receipt: a small signed envelope holding that output's Outgoing Cipher Key. Anyone with the receipt, the recipient, an auditor or a public ledger, recovers exactly that payment (recipient, amount, memo) from the chain in their browser, without receiving a viewing key and without learning anything else about the payer. It is the outputs half of ZIP 311, implemented for the live Ironwood pool (activated July 2026, where no receipt tool existed), with a published format, deterministic test vectors, a Rust crate, a CLI, an npm verifier and a browser page. Receipts compose into audit packs whose totals are explicitly lower bounds. A thin payout console turns USD-denominated payables into two-person-approved shielded batches (via Zkool), issues receipts automatically after confirmation, and exports OpenZcash-, QuickBooks- and Xero-compatible CSVs plus per-recipient annual USD totals for 1099-NEC preparation. Verified receipts can be attested on Solana through a small program that checks the issuer's signature on-chain.

**Proof.** Mainnet v6 transactions parsed and fetched over gRPC; a consensus-valid transaction on a Zebra regtest chain issued from the sender's viewing key and verified online and offline; tamper cases fail closed at a named stage; 255 automated tests (34 Rust, 221 TypeScript) including the official Orchard note-encryption vectors. [Add: testnet/mainnet receipts and the pilot organisation once funded.]

**Market and impact.** Immediate users are Zcash grant programs and DAOs (FPF/ZCG pay 60+ milestones and 100+ bounties per quarter by hand) and Zcash-native payroll users such as Zcash Brazil on Konclave. The category is wider: Aleo, Tempo, Canton and Solana confidential balances all ship private payments in 2026 and none offers per-payment proof; under EU AMLR (2027) on-demand provability is the survival property for privacy assets. Top-down seat market ≈ $2.4–7.2M/yr (outer bound $4.7–14.0M); verification API and compliance licensing are the multiplier.

**Business.** Open-source core; issuer seats ($79–299/mo), hosted receipt pages and audit packs, verification API and licensing to compliance vendors. Execution tools (Konclave, ZBooks, Zallet) are integrations, not competitors: they plug in by exporting one key column.

**Traction targets by submission.** Baseline plan: ≥ 15 receipts on public chains, one real issuing organisation, one third-party integration, ≥ 3 public verifications; solo-branch plan (`11_plan.md` §4): ≥ 3 receipts, one issuing organisation, one external verification posted publicly. [Replace with actuals.]

**Team.** [Two founder-market-fit sentences from the team; roles.]

## 3. Videos

- Pitch (≤ 3:00): beat sheet in `11_plan.md` §5.
- Technical demo (2–3:00): outline in `11_plan.md` §5.
- Weekly updates: 2026-09-28, 2026-10-05 (60 s each).

## 4. Repository readiness

- [x] README with proof, prior art, status, what is/isn't proven
- [x] `docs/PRE_EVENT_STATE.md`, `docs/PRIOR_ART.md`
- [x] Commit history inside the window (first commit 2026-09-21 PT; `git log` shows 2026-09-22 00:07 +08:00)
- [ ] CI green on GitHub (needs push)
- [ ] In this order (RSK-17; publishing is irreversible): 1. `cargo audit` clean + secrets scan (3.4.2.3, 10-08 → 10-09) → 2. tag v0.1.0 + release notes (4.1.1.4, 10-09) → 3. `npm publish @zeceipt/verify` (4.1.1.3, U, 10-10)
- [ ] Demo page hosted (GitHub Pages or zeceipt.xyz)

## 5. Timeline (authoritative for external milestones)

This table is the authority for dates visible outside the team (posts, videos, uploads, user asks). Engineering dates are authoritative in `11_plan.md` §3; the rows below are its fixed points and the two must not disagree.

| Date | Milestone | Source |
|---|---|---|
| 2026-09-22 | Product/research phase closed; window-open date confirmed (U) | `11_plan.md` §3 |
| 2026-09-24 | Push repo, CI green, forum post, pilot outreach | `08` §2 |
| 2026-09-25 | Funding checkpoint (RSK-3 trigger) | `06` |
| 2026-09-27 | zips #387 post | `08` §2 |
| 2026-09-28 | Weekly update video 1; register `zeceipt.xyz` (U) | `08` §2, WBS 4.1.1.2 |
| 2026-09-30 | Konclave author outreach with adapter draft (3.3.3.1 lands 09-30) | `08` §2 |
| 2026-10-01 | First pilot batch (testnet/mainnet) | `08` §2 |
| 2026-10-03 | Console + Solana status review; cut decisions | `06` RSK-6/7, `11` §2 |
| 2026-10-05 | Initial upload; weekly update 2 (shift to the actual window-open day) | `11` §3 |
| 2026-10-09 | Final videos uploaded; v0.1.0 release published | `11` §3, WBS 4.1.1.4 |
| 2026-10-10 | Freeze; form re-check; `npm publish @zeceipt/verify` (U; a release action, the day after the audit and tag) | `11` §3, WBS 4.1.1.3 |
| 2026-10-11 | Final submission | `11` §3 |
| 2026-10-12 | Deadline (buffer) | `[R1]` |

## 6. Judging criteria and evaluation factors → repo artefacts

Six criteria (rules §8) `[R1]`:

| Criterion | Where it is answered |
|---|---|
| Functionality — how well it works, code quality | 255 tests (34 Rust, 221 TypeScript), clippy `-D warnings`, `docs/PROOF.md` §1–§5, CI workflow, implementation review 100/100 (journal) |
| Potential Impact — TAM, ecosystem effect | `03_market_competition.md` §1; `02_personas_jtbd.md` §0; `07_compliance_tax.md` §3 |
| Novelty | first per-output receipts on Ironwood; format + vectors; `docs/PRIOR_ART.md` states exactly what is new vs Glasspane/ZIP 311 |
| UX — using the chain for downstream users | no-login browser verification, three-part outcome, proves/does-not-prove copy (`04_ux_flows.md`, spec §4) |
| Open-source, composability | MIT; crates + npm + vectors; well-known key file; Konclave/OpenZcash adapters (`05_data_model_api.md` §4) |
| Business Plan, team ability | `08_gtm_pricing.md`; `11_plan.md` §1–§4; team section (U) |

Seven FAQ factors `[R1]`:

| Factor | Where |
|---|---|
| Founder-market fit | pitch 2:50; description "Team" (U) |
| Unique insight | disclosure layer, not execution layer; per-output vs all-or-nothing (`03` §4, `11` §6) |
| Product execution / shipping speed | commit history in window; PROOF evidence classes; weekly update videos |
| Potential market size | `03` §1 |
| Founder communication | pitch video; forum post; zips #387 post |
| Business viability | `08` §4 pricing with benchmarks |
| Traction | `11` §4 metrics with actuals at submission |
