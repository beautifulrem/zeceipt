# Colosseum submission checklist

Source for fields and rules: `[R1]` (form fields captured 2026-09-17 from the FAQ; re-check the live form on the day the window is confirmed, WBS 1.1.1.4). Deadline 2026-10-12 23:59 PT; window assumed to open ~2026-10-05 (confirm). One submission per team; all content in English; misrepresenting development history or failing to disclose pre-existing code disqualifies `[R1]`.

## 1. Form fields

| Field | Content / decision | Status |
|---|---|---|
| Product name | Zeceipt (confirm) | 👤 |
| Description | ≤ 500 words; draft in §2: 425 words of text plus three placeholders budgeted at 10 + 20 + 40 words, 495 in total when filled (count: whitespace-separated tokens from **Problem.** to the end of **Team.**) | 🟡 fill the placeholders within their budgets |
| Blockchains and tools integrated | Zcash: Ironwood, Orchard and Sapling; lightwalletd and Zaino gRPC; Zkool GraphQL; Zebra on regtest | ✅ Solana and NEAR Intents were dropped with the solo branch (`11_plan.md` §1.1), which forfeits accelerator eligibility `[R1]` |
| Track | Zcash | ✅ |
| Category | **Developer Infrastructure**: the solo branch replaced the baseline on 2026-09-24, since no second person was confirmed (`11_plan.md` §1.1, RSK-19), and its rule forces this category. Payments & Remittance would have been the primary otherwise | ✅ by rule |
| Team members with background | names, roles, 2-line bios | 👤 |
| Team location / country | | 👤 |
| Logo / graphic | a plain text wordmark (the designed logo, WBS 5.1.2.5, was dropped with the solo branch) | ⬜ |
| GitHub repository | public URL (open source encouraged; private allowed with judge access) | 👤 push |
| Presentation (pitch) video | ≤ 3 min, YouTube unlisted | ⬜ |
| Product demo video | ≤ 3 min technical, YouTube unlisted | ⬜ |
| Go-to-market | draft in §2b (slice D9): first users, channels, milestones, draft pricing | 🟡 fill the status placeholder |
| Live demo / website URL | `zeceipt.xyz` demo page (or GitHub Pages fallback) — field not in the 2026-09-17 capture; prepare anyway | ⬜ |
| X / social handle | team handle for weekly updates — not in the capture; prepare anyway | 👤 |
| AI-assistance disclosure | if the form asks: AI-assisted coding and research were used; all cryptography comes from upstream crates; disclose plainly | ⬜ |
| isUniversityProject / isSolanaMobile | no / no | ✅ |

## 2. Description draft (≤ 500 words, English; rewritten in slice D8 from what the code and PROOF show)

Sources, not part of the submitted text: the ledger figures `[R105]`, the FPF quarter `[R4]`, Ironwood's activation `[R20]`; each other claim maps to evidence in `.trellis/tasks/09-26-submission-description/implement.md`.

**Problem.** Organisations that pay contributors in shielded Zcash cannot prove a single payment. Today they can only hand over a viewing key, which exposes every payment the wallet ever made, or a spreadsheet the auditor has to trust. OpenZcash mirrors ZCG's ledger of 1,016 disbursements, 825 of them marked paid (budgeted at $23.3M), and not one row is checked against the chain.

**What Zeceipt does.** Every output an organisation pays becomes a receipt: a small, optionally signed envelope holding that output's Outgoing Cipher Key. Anyone holding the receipt recovers exactly that payment from the chain in a browser: recipient, amount, memo. They receive no viewing key and see no other payment. It uses ZIP 311's output disclosure, without its spend-authority requirement, for the Ironwood pool (live since 2026-07-28), Orchard and Sapling.

It ships as:
- a specified format with deterministic test vectors;
- Rust crates and a CLI;
- a browser verifier compiled to WebAssembly, packaged for npm (publishing pending);
- a receipt page that keeps the receipt in the browser.

Receipts compose into audit packs whose totals are lower bounds. An issuer can bind its signing key to its domain with a well-known file; the CLI and the page check it on request.

**The payout console.** A self-hosted console turns USD payables into shielded batches at Kraken's rate, approved by the operator and paid through Zkool in one transaction. Receipts are issued automatically after confirmation. It never holds a spending key: the seed stays in Zkool, receipts come from a viewing key, and its Zkool token can pay only from its own account. A database restored from a backup adopts a mined payment rather than paying it again. Its pages can't be framed and run only their own scripts.

**Proof.**
- Mainnet v6 transactions parsed and fetched over gRPC.
- On a Zebra regtest chain: a consensus-valid Ironwood transaction, with receipts issued from the sender's viewing key and verified over gRPC and offline; and the console end to end, from USD payables at Kraken's live rate to verified receipts.
- Tampered receipts fail closed at a named stage.
- 450 automated tests (47 Rust, 403 TypeScript), including the official Orchard note-encryption vectors, plus opt-in Chrome suites for the console and the receipt page.
- [Public-chain receipts and the pilot organisation: ≤ 10 words.]

**Market.** First users are Zcash grant programs and DAOs: FPF's Q1 2026 report lists 62 milestone payouts and 129 ZecHub bounty payments. Then payroll teams, such as Konclave's users.

**Business.** An open-source core; planned revenue from issuer seats, hosted receipt pages and audit packs, and a verification API.

**Traction.** [Actuals: public receipts, the issuing organisation, public verifications: ≤ 20 words.]

**Team.** [Founder-market fit and roles: ≤ 40 words.]

## 2b. Go-to-market draft (form field "Go-to-market strategy and distribution plans"; slice D9)

Sources, not part of the submitted text: demand `[R3]` (forum #56300, re-read 2026-09-26), the FPF quarter `[R4]`, targets `11_plan.md` §4 (solo branch), pricing `08_gtm_pricing.md` §4; each claim maps to evidence in `.trellis/tasks/09-26-gtm-paragraph/implement.md`.

**Who first.** Zcash grant and bounty programs, which pay in shielded ZEC and account for it in public: ZCG's ledger is published on OpenZcash, and ZecHub DAO made 129 bounty payments in one quarter. Then ZCG's grantees and payroll teams. The community has named the gap: in a June forum thread on viewing keys for accounting, one reply put it as "The encryption is done; the boring middle is not."

**How it spreads.**
- A receipt travels as a link to a page that verifies it in the browser, so each payment shows the product to the person paid and to whoever checks it.
- An open-source core (MIT): the format, test vectors, Rust crates, a CLI and a browser verifier, so wallets and payout tools can issue or check receipts without us.
- The Zcash forum: a public call for one pilot team, which pays a real batch and sends its contributors their receipt links.
- The standard: an implementation report for ZIP 311's discussion, asking whether an outputs-only profile could be standardised, so receipts can become a common format rather than ours alone.

**Milestones.** By submission: at least 3 receipts on a public chain, one issuing organisation, one receipt verified publicly by someone outside the team. In 90 days: 2 organisations, 100 receipts a month, one integration with a payout tool.

**Pricing (draft).** The core stays free and open source, with a free hosted tier; paid hosted tiers start at $79 a month; a usage-priced verification API for auditors and compliance vendors comes later.

[Status at submission: which posts are live, the pilot organisation, receipts issued.]

## 3. Videos

- Pitch (≤ 3:00): beat sheet in `11_plan.md` §5.
- Technical demo (2–3:00): outline in `11_plan.md` §5.
- Weekly updates: 2026-09-28, 2026-10-05 (60 s each).

## 4. Repository readiness

- [x] README with proof, prior art, status, what is/isn't proven
- [x] `docs/PRE_EVENT_STATE.md`, `docs/PRIOR_ART.md`
- [x] Commit history inside the window (first commit 2026-09-21 PT; `git log` shows 2026-09-22 00:07 +08:00)
- [ ] CI green on GitHub (needs push)
- [ ] In this order (RSK-17; publishing is irreversible): 1. `scripts/security_review.sh` passes: `cargo audit`, `npm audit`, the secrets scan (3.4.2.3, 10-08 → 10-09; first pass 2026-09-25, `docs/SECURITY_REVIEW.md`) → 2. tag v0.1.0 + release notes (4.1.1.4, 10-09) → 3. `npm publish @zeceipt/verify` (4.1.1.3, U, 10-10)
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
| Functionality — how well it works, code quality | 450 tests (47 Rust, 403 TypeScript), clippy `-D warnings`, `docs/PROOF.md` §1–§5, CI workflow, implementation review 100/100 (journal) |
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
