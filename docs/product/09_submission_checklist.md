# Colosseum submission checklist

Source for fields and rules: `[R1]` (form fields captured 2026-09-17 from the FAQ, re-read 2026-09-26 `[R109]`; re-check the live form on the day the window is confirmed, WBS 1.1.1.4). Deadline 2026-10-12 23:59 PT; window assumed to open ~2026-10-05 (confirm). One submission per team; all content in English; misrepresenting development history or failing to disclose pre-existing code disqualifies `[R1]`.

## 1. Form fields

| Field | Content / decision | Status |
|---|---|---|
| Product name | Zeceipt (confirm) | 👤 |
| Description | ≤ 500 words; draft in §2: 448 words of text plus two placeholders budgeted at 20 + 30 words, 498 in total when filled (2 words of slack) (count: whitespace-separated tokens from **Problem.** to the end of **Team.**). Recomputed 2026-09-30 (PM round 2, N04): the Proof placeholder is filled (11 words) with the testnet receipts and the `zdp:1:` proof, "What Zeceipt does" gains the recipient sentence (9 words), and Team's budget goes from 40 to 30 | 🟡 fill Traction and Team within their budgets |
| Blockchains and tools integrated | Zcash: Ironwood, Orchard and Sapling; lightwalletd and Zaino gRPC; Zkool GraphQL; Zebra on regtest | ✅ Solana and NEAR Intents were dropped with the solo branch (`11_plan.md` §1.1), which forfeits accelerator eligibility `[R1]` |
| Track | Zcash | ✅ |
| Category | **Developer Infrastructure**: the solo branch replaced the baseline on 2026-09-24, since no second person was confirmed (`11_plan.md` §1.1, RSK-19), and its rule forces this category. Payments & Remittance would have been the primary otherwise | ✅ by rule |
| Team members with background | "All teammates, with context on their backgrounds and previous experience" `[R109]`: names, roles, backgrounds, previous experience | 👤 |
| Team location / country | | 👤 |
| Logo / graphic | the original mark, `docs/assets/zeceipt-icon.svg` (with `zeceipt-mark.svg`; added 2026-09-29 with the public release, `ba6abac`; WBS 5.1.2.5); a PNG exported from it for the form at the upload | ✅ mark; PNG at upload |
| GitHub repository | https://github.com/beautifulrem/zeceipt, public since 2026-09-29, Apache-2.0 (open source encouraged; the private alternative was access for hackathon@colosseum.com `[R109]`) | ✅ |
| Colosseum account (each member) + project registered on the Arena | each member signs in at colosseum.com with a completed profile, and the project is created on the Arena; rule 6 requires every member to register and fill in the profile by 2026-10-12 23:59 PT (KB `03_rules_eligibility.md`); the weekly updates and the upload most likely need the project (§5, 09-28 row). Owner-only, ASAP: WBS 5.2.1.0 and the asks table (added 2026-09-30, PM round 3, D11 residue) | 👤 |
| Presentation (pitch) video | 2–3 min ("one of the first resources judges review" `[R109]`), YouTube unlisted | ⬜ |
| Product demo video | ≤ 3 min, how the product works `[R109]`, YouTube unlisted | ⬜ |
| Go-to-market (the form asks for "Go-to-market strategy, demand validation, and plans for developing distribution" `[R109]`) | draft in §2b (slice D9): first users, demand in a user's words, channels, milestones, draft pricing | 🟡 fill the status placeholder |
| Live demo / website URL | `https://beautifulremi.dpdns.org/zeceipt/` (GitHub Pages, enabled 2026-09-30, deployed by `.github/workflows/pages.yml`): the demo; the receipt page verifying zeceipt's own signed testnet receipts (PROOF §6); and a third party's mainnet `zdp:1:` payment (zcash-delivery-proof's test vector, not zeceipt's, PROOF §7). In the form, give the README's testnet receipt link (INV-T-001), not the root, which opens the demo (PM round 2, N04). The domain is the owner's (RSK-29) — field not in the 2026-09-17 capture; prepare anyway | ✅ |
| X / social handle | team handle for weekly updates — not in the capture; prepare anyway | 👤 |
| Past development work (required: "teams must disclose all relevant past development work in the submission form" `[R109]`) | Draft, from `docs/PRE_EVENT_STATE.md`: the repository started on 2026-09-21 PT, a week into the event, and no product code predates it; before the event there was only a general study library of other hackathons' winning projects (June 2026: notes, and local clones of their public repositories for reading), not specific to this product, and none of that code is used; the competition research and the product definition were written during the event (2026-09-17 → 09-21) in a private knowledge base, before the repository started; third-party material is published crates and npm packages (lockfiles), and data files copied unchanged and attributed in `NOTICE` (`zcash-test-vectors` vectors; zecpay's sample CSV; the Geist fonts and Lucide icons); the development workflow's local tooling is not part of the repository; `docs/PRIOR_ART.md` reviews other people's projects and none of their code is used. The same statement is public in `docs/PRE_EVENT_STATE.md` and the README "For judges" section. The user adds any earlier work only they know of | ⬜ the user confirms and submits it |
| AI-assistance disclosure | Disclosed in the README ("How it was built") and `docs/PRE_EVENT_STATE.md` on 2026-09-30, with the three history rewrites of 09-29: AI coding assistants directed by one developer; all cryptography from upstream crates; dates and code unchanged by the rewrites. Paste the same paragraph into the form if it asks | ✅ |
| isUniversityProject / isSolanaMobile | no / no | ✅ |

## 2. Description draft (≤ 500 words, English; rewritten in slice D8 from what the code and PROOF show)

Sources, not part of the submitted text: the ledger figures `[R105]`, the FPF quarter `[R4]`, Ironwood's activation `[R20]`; each other claim was checked against PROOF, the tests or the research log.

**Problem.** Organisations that pay contributors in shielded Zcash have no practical way to prove a single payment. Today they usually hand over a viewing key, which exposes every payment the wallet ever made, or a spreadsheet the auditor has to trust. OpenZcash mirrors ZCG's ledger of 1,016 disbursements, 825 of them marked paid (budgeted at $23.3M), and not one row is checked against the chain.

**What Zeceipt does.** Every output an organisation pays becomes a receipt: a small, optionally signed envelope holding that output's Outgoing Cipher Key. Anyone holding the receipt recovers exactly that payment from the chain in a browser: recipient, amount, memo. They receive no viewing key and see no other payment. It uses ZIP 311's output disclosure, without its spend-authority requirement, for the Ironwood pool (live since 2026-07-28), Orchard and Sapling. Recipients can prove payments too, with zcash-delivery-proof's `zdp:1:` proofs.

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
- 558 automated tests (93 Rust, 465 TypeScript), including the official Orchard note-encryption vectors, plus opt-in Chrome suites for the console and the receipt page.
- Verified: three signed testnet receipts; a third party's mainnet `zdp:1:` proof.

**Market.** First users are Zcash grant programs and DAOs: FPF's Q1 2026 report lists 62 milestone payouts and 129 ZecHub bounty payments. Then payroll teams, such as Konclave's users.

**Business.** An open-source core; planned revenue from issuer seats, hosted receipt pages and audit packs, and a verification API.

**Traction.** [Actuals at submission, as they stand, confirmed by the owner: public-chain receipts (3 on testnet, 2026-09-30; mainnet only if funded by 10-02), the pilot organisation (none expected, RSK-28), verifications posted by someone outside the team (none on 09-30): ≤ 20 words.]

**Team.** [Founder-market fit and roles: ≤ 30 words.]

## 2b. Go-to-market draft (form field "Go-to-market strategy and distribution plans"; slice D9)

Sources, not part of the submitted text: demand `[R3]` (forum #56300, re-read 2026-09-26), the FPF quarter `[R4]`, targets `11_plan.md` §4 (solo branch), pricing `08_gtm_pricing.md` §4; each claim was checked against PROOF, the tests or the research log.

**Who first.** Zcash grant and bounty programs, which pay contributors in ZEC and account for it in public: ZCG's ledger is mirrored on OpenZcash from its public sheet, and FPF made 129 ZecHub bounty payments to 33 recipients in one quarter. Our first pilot target is ZecHub's bounty program, with whoever sends its payments (today FPF) issuing the receipts from that wallet's viewing key; then ZCG's grantees and payroll teams. The community has named the gap: in a June forum thread on viewing keys for accounting, Michae2xl wrote "The encryption is done; the boring middle is not.", listing a scoped, logged disclosure for the auditor among the missing pieces.

**How it spreads.**
- A receipt travels as a link to a page that verifies it in the browser, so each payment shows the product to the person paid and to whoever checks it.
- An open-source core (Apache-2.0): the format, test vectors, Rust crates, a CLI and a browser verifier, so wallets and payout tools can issue or check receipts without us.
- The Zcash forum: a public call for one pilot team, which pays a real batch and sends its contributors their receipt links.
- The standard: an implementation report for ZIP 311's discussion, asking whether an outputs-only profile could be standardised, so receipts can become a common format rather than ours alone.

**Milestones.** By submission: 3 signed receipts on Zcash testnet (done), and mainnet receipts if the wallet is funded by 10-02; the pilot call is posted, and any organisation that answers is named with its consent. In 90 days, as targets: one organisation issuing receipts for its own payments, and one integration with a payout tool. In 12 months: a verifier pilot on a second chain with private payments (Solana confidential balances or Aleo records), which needs that chain's own disclosure primitive.

**Pricing (draft).** The core stays free and open source, and hosting is free up to 20 receipts a month; above that, paid hosted tiers start at $79 a month. A usage-priced verification API for compliance vendors, exchanges and ledgers comes later.

[Status at submission, prefilled 2026-09-30 for the owner to confirm: receipts issued: 3 on testnet (PROOF §6), mainnet if funded by 10-02; the pilot organisation: none yet (RSK-28 triggered on 09-30); posts live: the forum call and the zips #387 comment if the owner has posted them, otherwise none.]

## 3. Videos

- **Pitch (≤ 3:00):** script and shot list in `docs/outreach/pitch-video.md` (rewritten 2026-09-30 for the dossier pivot; appraisal round 2, E14), about 2:40 of voice-over and 20 s of the owner's ask and team line.
  - Footage: screen recordings of the live pages only (`case/#sample`, `build/`), in a clean browser profile at 1440×900, light theme. No console or regtest footage: the take `20260930083345` (`docs/outreach/footage-20260930.md`) belongs to the building blocks and is not used.
  - The case page is recorded as a reviewer meets it: amber, "Claims verified — control not shown", then green, "Verified, with control", after "Try it with the nonce the sample answered"; then the tampered copies, a changed nonce (red) and a removed path claim (amber, "Claims verified — funds not fully explained", the check against mixing).
  - The user's part: the on-camera rows, the team line, narration, editing and uploading (WBS 5.1.1.1, 5.1.1.4). Recording window 10-08 → 10-09.
- **Technical demo (≤ 3:00):** script and shot list in `docs/outreach/tech-demo-video.md` (rewritten 2026-09-30; appraisal round 2, E14), about 2:40: one real control challenge on testnet, from the reviewer's nonce to a green case page.
  - Footage: the live case and build pages and a terminal (`zeceipt dossier nonce`, `dossier verify`, `dossier serve` with `curl`), screen-recorded directly; no console or regtest footage. The wallet send is the owner's, on testnet, with no identity file, mnemonic or path on screen.
  - NU7 activates on testnet on 10-06: the challenge transaction must be mined before then. If it is not, the script's fallback uses PROOF §8's recorded challenge (`10e941e7…6e43`).
  - The case page goes amber (no nonce; the dossier's own nonce shown only by its beginning), green once the reviewer's nonce is pasted, then red (a changed nonce) and amber, "funds not fully explained" (a removed path claim).
  - The user's part: the wallet send, narration, editing and uploading (WBS 5.1.1.2).
- **Both scripts** carry a do-not-say list: the exchange sample is "a simulated exchange-deposit review on testnet (we ran the exchange's wallet)", never "a real exchange"; no "mainnet", "users", "audited" or "works after NU7". The claims that depend on the user's own steps (the forum post, a reviewer's statement, a mainnet dossier) are marked conditional.
- **Weekly updates:** 2026-09-28, 2026-10-05 (60 s each). The first (`docs/outreach/weekly-update-1.md`) was recorded as skipped on 2026-09-30, its fallback date (PM round 3, P09); the second is `docs/outreach/weekly-update-2.md`, due 10-05.

## 4. Repository readiness

- [x] README with proof, prior art, status, what is/isn't proven
- [x] `docs/PRE_EVENT_STATE.md`, `docs/PRIOR_ART.md`
- [x] Commit history inside the window (first commit 2026-09-21 PT; `git log` shows 2026-09-22 00:07 +08:00)
- [x] CI green on GitHub: the repository is public since 2026-09-29 (first green run 36595874577, `e8c5058`); green on master since `d33ecd8` (run 36626374879)
- [ ] In this order (RSK-17; publishing is irreversible), moved earlier on 2026-09-30 (PM round 2, D04): 1. `scripts/security_review.sh` passes on the commit to be tagged: `cargo audit`, `npm audit`, the secrets scan (CI's security job runs it on every push, green since `fd5271a`; first pass 2026-09-25, `docs/SECURITY_REVIEW.md`) → 2. tag v0.1.0 + release notes (4.1.1.4, 10-02 → 10-03; 👤 the push and the GitHub release) → 3. `npm publish @zeceipt/verify` (4.1.1.3, 👤, 10-03). The pre-submission rerun (3.4.2.3, 10-08 → 10-09) stays; a finding then ships as v0.1.1
- [ ] Before the tag (10-02 → 10-03), a stale-phrase sweep of what the release and the posts carry (PM round 2, N01 ④; round 3). Run from the repository root; each command must print nothing:
  - `grep -rnE 'waits on faucet|No receipts on a public chain|Footage \(regtest only|not enforce HTTPS|20260925230743|20260926144231|20260926182327|20260926184526' CHANGELOG.md docs/release docs/outreach --exclude=footage-20260930.md` (old claims and the takes of 09-25/26, which `footage-20260930.md` names only as replaced);
  - `grep -rnoE '[0-9]+ run by default|[0-9]+ Rust|[0-9]+ console' CHANGELOG.md docs/release docs/outreach | grep -vE '\b(540 run by default|75 Rust|465 console)\b'` (every count agrees with `python3 scripts/check_test_counts.py` on the day; update the three numbers in this line when the suites change).
  
  Any hit is fixed before the tag, or the tag waits. Not scripted: a manual step, like the rest of `docs/RELEASING.md`.
- [x] Demo page hosted: GitHub Pages, enabled 2026-09-30, `https://beautifulremi.dpdns.org/zeceipt/` (the receipt page and the demo, deployed by `.github/workflows/pages.yml`)
- [x] HTTPS enforced on the Pages site since 2026-09-30 (`https_enforced: true`; http answers 301 to https; the owner's setting, RSK-29; PM round 3, P04)
- [x] Receipts on a public chain: three signed testnet receipts, 2026-09-30 (PROOF §6, `fixtures/testnet/`); mainnet 👤 (funds by 10-02)

## 5. Timeline (authoritative for external milestones)

This table is the authority for dates visible outside the team (posts, videos, uploads, user asks). Engineering dates are authoritative in `11_plan.md` §8 (the solo schedule, baseline v2; §3 is baseline v1); every row below is one of §8's dates or asks, and the two must not disagree. Re-dated 2026-09-30 (PM round 2, D04, N12, N13): the testnet run and the hosting are done; the tag and npm move to 10-02 → 10-03; the UI freeze starts 10-01; the forum call is dated 10-01. Re-derived 2026-09-26 (slice D10c): of the baseline rows due by 09-27, the product phase closed on time; the push, the forum post with its pilot outreach, the funding checkpoint and the window-date confirmation passed unanswered and are re-dated below; the zips #387 post, the Konclave adapter outreach and the Solana review were dropped with the solo branch (the zips comment is drafted and posting it is the user's option, `11_plan.md` §1.1).

| Date | Milestone | Source |
|---|---|---|
| 2026-09-22 | Product/research phase closed ✅ | `11_plan.md` §3 |
| 2026-09-28 | Push the repo and enable CI (✅ done 2026-09-29, public); confirm the product name; register the project on the Arena if it is not yet (weekly updates and the upload most likely need it); record and post weekly update 1 (fallback: by 09-30, or skipped; recorded as skipped on 09-30, P09); then post the forum pilot call (U) | `11_plan.md` §8; WBS asks |
| 2026-09-30 | ✅ Testnet done 09-30: the faucet claim and three signed receipts (PROOF §6). ✅ The page hosted on GitHub Pages (4.1.1.2, a day early), HTTPS enforced. ✅ Regtest footage re-recorded (take `20260930083345`). Mainnet funding of the issuing wallet (U) stays open, to 10-02. Colosseum profiles and the project on the Arena (U, 5.2.1.0): ASAP, overdue since 09-28 | `11_plan.md` §8; WBS asks |
| 2026-10-01 | UI freeze (the receipt page, the demo, the console: blocking fixes only); post the forum pilot call (U), the day of the Zcash Foundation's architecture workshop; decide whether to contact Konclave's author as a pilot channel (U) | `11_plan.md` §8; WBS asks |
| 2026-10-01 → 10-03 | The public-chain shots (`../raw/demo/public-20260930/`) by 10-03, before the narration on 10-04; the regtest footage was re-recorded on 09-30 and the freeze keeps it valid (only a blocking fix that changes a segment re-records it); mainnet go/no-go by the owner by 10-02 (U; no decision → testnet only, RSK-3); the issuer's well-known file served from the user site by 10-02 (U, WBS 4.1.1.5, once R has made it; not served → the binding stays "unknown", PM round 3, N11); tag v0.1.0 and the GitHub release on 10-02 → 10-03 (R cuts the tag, 👤 pushes it and creates the release); `npm publish @zeceipt/verify` on 10-03 (👤, after the tag); the pilot is not expected (RSK-28 triggered 09-30): a batch from a later answer is named with consent | `11_plan.md` §8; WBS 4.1.1.4, 4.1.1.3 |
| 2026-10-03 | Team roster and founder lines; confirm the window-open date, inferred 10-05 or 10-06 `[R106]` (U) | `11_plan.md` §8; WBS asks |
| 2026-10-04 → 10-07 | Pitch video and technical demo recorded | `11_plan.md` §8 |
| 2026-10-05 | Record and post weekly update 2 (U; fallback: by 10-07, or skipped); initial upload on the window-open day | `11_plan.md` §8 |
| 2026-10-06 | Testnet NU7 activates: re-check the README's testnet receipt link and `verify-pack` of the testnet pack online; if either fails, the README's first link falls back to the file load or the labelled zdp mainnet link | `11_plan.md` §8; RSK-14b |
| 2026-10-09 | Security review rerun (pre-submission; a finding ships as v0.1.1); videos uploaded unlisted and links tested; team backgrounds and location (U) | `11_plan.md` §8; WBS 3.4.2.3 |
| 2026-10-10 | Freeze; form re-check (the tag and npm fall back here only if they missed 10-03) | `11_plan.md` §8 |
| 2026-10-11 | Final submission | `11_plan.md` §8 |
| 2026-10-12 | Deadline (buffer) | `[R1]` |

## 6. Judging criteria and evaluation factors → repo artefacts

Six criteria (rules §8) `[R1]`:

| Criterion | Where it is answered |
|---|---|
| Functionality — how well it works, code quality | 558 tests (93 Rust, 465 TypeScript), clippy `-D warnings`, `docs/PROOF.md` §1–§7 (§6: zeceipt's testnet receipts; §7: a third party's `zdp:1:` proofs), CI workflow |
| Potential Impact — TAM, ecosystem effect | `03_market_competition.md` §1; `02_personas_jtbd.md` §0; `07_compliance_tax.md` §3 |
| Novelty | issuer-attributed, chain-fetched per-output receipts for Ironwood, Orchard and Sapling, with a payout workflow; see PRIOR_ART (`docs/PRIOR_ART.md` states what is new against ZIP 311, Glasspane, zcash-delivery-proof and the 2026-09-30 rescan, `[R135]`); format + vectors |
| UX — using the chain for downstream users | no-login browser verification, three-part outcome, proves/does-not-prove copy (`04_ux_flows.md`, spec §4); one design system for the receipt page and the console, light and dark, WCAG AA contrast tested per token pair `[R134]` |
| Open-source, composability | Apache-2.0 `[R133]`; crates + npm package (publishing is the user's) + vectors; the issuer's well-known key file; an OpenZcash-compatible export (built, slices X1–X2c); planned in the solo schedule: a CSV import of Konclave's format (`11_plan.md` §8; `05_data_model_api.md` §4) |
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
