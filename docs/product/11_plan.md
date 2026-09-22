# Plan: schedule, effort, cut order, metrics, videos, judge answers

This is the executable plan for 2026-09-22 → 2026-10-12. External milestones (posts, videos, uploads, user asks) are authoritative in `09_submission_checklist.md` §5; engineering dates are authoritative in §3 below; effort and cut rules live here. Roles: R (Rust/protocol), T (TypeScript/product), PM (product/pitch), U (user-only actions).

## 1. Effort budget (person-days)

Baseline assumes two people (R and T/PM) at one person-day each per calendar day. Rows whose WBS cell starts with `WBS` are the sums of the estimates written on the WBS leaves (`00_wbs.md`); `scripts/check_product_docs.py` recomputes those sums and the slack line, so the numbers cannot drift. Must 1/2 are completed budget lines; Must 6 and Buffer are budget lines without leaves. User-only (👤) leaves carry no person-days: they are the user's time, not team capacity.

| Deliverable | WBS | Person-days | Owner | Status 2026-09-22 |
|---|---|---|---|---|
| Must 1 Receipt core incl. proofs (mainnet-read, synthetic, regtest) | 3.1.2, 3.1.3, 3.4.1 (done) | 4 | R | ✅ done (PROOF §1–§5) |
| Must 2 Format + vectors + CLI + npm package | 3.2.1, 3.2.3 (done) | 2 | R | ✅ done (publish is U) |
| Must 3 Payout console: foundations, payables, batches, execution | WBS 3.3.1, 3.3.5 | 6.0 | R 3.5 + T 2.5 | ⬜ |
| Must 4 Auto-issuance + public receipt page | WBS 3.3.6.1, 3.3.6.2 | 2.0 | R 1.0 + T 1.0 | ⬜ |
| Must 5 Audit-pack page + exports + well-known keys | WBS 3.3.6.3, 3.3.3.3 | 2.0 | R 2.0 | 🟡 CLI pack done; rest ⬜ |
| Must 6 Public-chain evidence + README (T runs issuance and writes PROOF once U has funded the wallet) | 3.4.1.4, 3.4.1.5 are U | 1 | T | 🟡 regtest done; testnet/mainnet blocked on funding (U) |
| Must 7 Solana attestation program (minimal) + 1Click fallback | WBS 3.3.2 | 1.5 | R 0.75 + T 0.75 | ⬜ |
| Should 8 Spend-authority proof prototype (ZIP 311 spends half) | WBS 3.3.4.5 | 2.0 | R | ⬜ |
| Should 9 Konclave / OpenZcash adapters | WBS 3.3.3.1, 3.3.3.2 | 1.5 | T | ⬜ |
| Should 10 Format post to zips #387 + forum | WBS 3.3.3.4 | 0.5 | R | ⬜ (2026-09-27) |
| Should 11 Notifications + reconciliation view | WBS 3.3.6.4 | 1.0 | T | ⬜ |
| Open technical investigations (timeboxed) | WBS 3.3.4.1, 3.3.4.2, 3.3.4.3, 3.3.4.4 | 1.0 | R | ⬜ |
| Community + pilot outreach (forum, Discord, zips thread, 4 pilot candidates) | WBS 4.1.2, 4.2.1 | 2.5 | PM 2.25 + R 0.25 | ⬜ |
| Videos ×2 + weekly updates ×2 + upload | WBS 5.1.1 | 2.0 | PM | ⬜ |
| Submission materials and process (release tag + notes, description, category, upload, freeze, final) | WBS 4.1.1.4, 5.1.2, 5.2.1 | 1.75 | PM 1.5 + R 0.25 | ⬜ |
| Buffer | — | 2 | T | reserve (investigations excluded; they have their own line) |
| **Total** | | **32.75** | | done (✅ rows) **6.0** → open **26.75** vs capacity **28.5** (2026-09-23 → 10-11 = 19 days × 2 people × 0.75; 09-22 was spent on this package) → slack **1.75** |

Per-owner forward load (open work only, from the Owner column): **R = 11.25** (Must 3 3.5, Must 4 1.0, Must 5 2.0, Must 7 0.75, Should 8 2.0, Should 10 0.5, investigations 1.0, outreach 0.25, release 0.25) against 14.25 pd capacity (19 days × 0.75); **T/PM = 15.5** (Must 3 2.5, Must 4 1.0, Must 6 1.0, Must 7 0.75, Should 9 1.5, Should 11 1.0, outreach 2.25, videos 2.0, submission 1.5, buffer 2.0) against 14.25 pd; 11.25 + 15.5 = 26.75 open. Two server-side console leaves (3.3.5.1 payables/CSV, 3.3.6.3 exports) are R-owned precisely to move load off the binding resource. **T/PM is the binding constraint, over by 1.25 pd on day one**, so cut-order items 1 and 4 (Should 11, T 1.0; single-source rate lock, T 0.5) are applied at once, bringing T/PM to 14.0 with the 2 pd buffer intact and 0.25 spare; R runs at 79%. The Konclave/OpenZcash adapters (Should 9) stay in scope: they are RSK-1's mitigation, the 09-29 outreach vehicle and the third-party-integration metric.

Cut trigger: cumulative slippage on T/PM work exceeding 2 pd, or the 2026-10-03 review, whichever comes first.

Failure floor (baseline): total T/PM relief available in the cut table is 4.0 pd (items 1, 2, 4, 5, 6, 9); items 1 and 4 spend 1.5 on day one, leaving 2.5 pd of further relief plus the 2 pd buffer and 0.25 spare, so the baseline absorbs ≈ 4.75 pd of T/PM slippage. Beyond that it degrades to the solo scope in §1.1 (one person's work with the other person's days as pure buffer).

Calendar levelling: §3 places every person-day-bearing leaf in a dated window such that each owner carries at most 0.75 pd per calendar day in every window (the checker recomputes this per row); the 2 pd buffer is placed explicitly (0.25 in 09-25 → 09-26, 0.25 in 10-01 → 10-03, 0.25 in 10-04 → 10-07, 0.25 in 10-08 → 10-09, 1.0 in 10-10 → 10-11).

### 1.1 Solo branch (headcount unconfirmed, WBS 2.4.3.3; RSK-19)

Every commit to date has one author. If a second person is not confirmed by 2026-09-24, this branch replaces the baseline from that day. Rule: multiply **all non-U work** (R, T and PM alike) by 1.6; U leaves are excluded from the budget entirely. Capacity 19 days (09-23 → 10-11) × 1 × 0.75 = **14.25 person-days**, of which 1.05 is held as buffer. AI-assisted implementation is the working mode but is not counted as capacity.

| Kept | Leaves / scope | Unscaled pd | Scaled pd |
|---|---|---|---|
| Console minimal: scaffold + custody config, data model, manual payable entry (no CSV import), batches with single-source rate, Zkool adapter, auto-issuance, receipt page | 3.3.1.1 (0.5), 3.3.1.3 (0.5), 3.3.5.1 reduced to manual entry (0.25), 3.3.5.2 single source (0.5), 3.3.5.4 (1.0), 3.3.6.1 (1.0), 3.3.6.2 (1.0) | 4.75 | 7.6 |
| Must 6 public-chain evidence + README, reduced to one testnet/mainnet batch and a PROOF section | budget line | 0.5 | 0.8 |
| Pitch + technical demo videos (both are form fields); no weekly updates | 5.1.1.1 (0.75), 5.1.1.2 (0.75) | 1.5 | 2.4 |
| Outreach minimal: forum post + one pilot (ZecHub DAO) | 4.1.2.2 (0.25 reduced), 4.2.1.1 (0.5) | 0.75 | 1.2 |
| Submission process minimal: description, upload, freeze, final | 5.1.2.2 (0.25 reduced), 5.2.1.1–.3 (0.5 reduced) | 0.75 | 1.2 |
| **Kept total** | | 8.25 | **13.2** |
| Buffer | | | 1.05 |
| **Capacity** | | | **14.25** |

Dropped in the solo branch (in this order, all recoverable if slack appears): Should 8, Should 11, Should 9, investigations, Should 10 (zips post, 0.8 scaled — first to add back), Solana entirely incl. the 1Click leg (accelerator eligibility is given up; 0.8), exports and audit-pack page (CLI pack + `receipts.json` feed remain), auth/roles UI (single operator with an env token; 3.3.1.2), API stub (3.3.1.4), approvals UI (single approver; HMAC still recorded; 3.3.5.3), Zallet and ZIP-321 adapters, well-known keys, Discord announcement and the other three pilots, weekly update videos. Submission category becomes Developer Infrastructure (`09_submission_checklist.md` §1).

Cuts below the line if the 1.05 pd buffer is consumed, in order: (1) auto-issuance UI → issue receipts with the CLI from a console export (3.3.6.1 1.0 → 0.5, frees 0.8 scaled); (2) receipt page → serve receipts through the existing demo page with a query-free URL (3.3.6.2 1.0 → 0.5, frees 0.8 scaled). Below that the branch fails and the submission ships the receipt core, CLI, npm package and proofs alone.

## 2. Cut order (two-person baseline; first cut → last cut)

Criterion: schedule relief on the binding resource (T/PM) first, product value second; each item states the owner and the person-days it frees so the 10-03 reviewer pulls the right lever. R-owned cuts free R only and do not shorten the critical path unless R is also loaded.

| # | Cut | Owner | Frees (pd) | Note |
|---|---|---|---|---|
| 1 | Should 11 notifications + reconciliation (3.3.6.4) | T | 1.0 | applied on day one (see §1) |
| 2 | Should 9 Konclave/OpenZcash adapters (3.3.3.1, 3.3.3.2) and the OpenZcash demo branch (4.2.1.4); keep the CSV import | T 1.5 + PM 0.25 | 1.75 | costs RSK-1's mitigation and the third-party-integration metric; update `06`, `08`, `03` §5 and `09` §2 if taken |
| 3 | Audit-pack page (keep the CLI pack; part of 3.3.6.3) | R | 0.5 | frees R only |
| 4 | Two-source rate lock → single source (3.3.5.2 1.0 → 0.5, same as the solo branch) | T | 0.5 | applied on day one (see §1) |
| 5 | Public ledger page (FLOW-5; stretch inside 3.3.6.2) | T | 0.25 | |
| 6 | Pilot 3 (4.2.1.3) | PM | 0.25 | keep ZecHub DAO and Zcash Brazil; 4.2.1.4 is priced in item 2 |
| 7 | Should 8 spend-authority prototype (3.3.4.5) | R | 2.0 | product-value cut; frees R only |
| 8 | Investigations 3.3.4.1–.3 (keep the NU7 re-test) | R | 0.75 | |
| 9 | Must 7 Solana program (3.3.2.1–3) → 1Click leg only (3.3.2.4) | R 0.75 + T 0.25 | 1.0 | last: costs accelerator eligibility |

Never cut: Must 1, 2, 4, 6. Decision point: 2026-10-03 status review (RSK-6, RSK-7), or earlier per the cut trigger in §1.

## 3. Day-by-day schedule (authoritative for engineering dates)

Columns follow the WBS owner letters: the R column lists only R-owned leaves, the T/PM column only T/PM/U-owned leaves. Each row is a dated window; the leaf person-days listed per owner never exceed 0.75 × days in the window, and every leaf's WBS date lies inside the window that lists it (`scripts/check_product_docs.py` verifies all three). Leaves cut on day one are netted by the person-days the cut frees (3.3.6.4 entirely; 3.3.5.2 counted at 0.5); the bracketed 3.3.6.4 is shown only for restoration. Fixed external dates come from `09_submission_checklist.md` §5. Non-leaf budget lines (Must 6 issuance runs, buffer) are named where they sit.

| Window | R (≤ 0.75 pd/day) | T / PM (≤ 0.75 pd/day; U in bold) | Milestone |
|---|---|---|---|
| 09-22 | Product docs; review rounds | Product docs; funding ask to U | Product/research phase closed |
| 09-23 → 09-24 | Data model + migrations (3.3.1.3); API routes (3.3.1.4); payables + CSV import (3.3.5.1) — 1.5 | Stack scaffold + custody config (3.3.1.1); auth/roles (3.3.1.2); forum post (4.1.2.2) — 1.5; **U: push repo, CI green (4.1.1.1)** | Repo public; console skeleton runs locally |
| 09-25 → 09-26 | Zkool adapter on regtest (3.3.5.4); ZIP-321 adapter (3.3.5.6) — 1.5; **funding check 09-25 (RSK-3 trigger)** | Batches with single-source rate lock (3.3.5.2, 0.5 after cut item 4); approvals with HMAC (3.3.5.3) — 1.0; buffer 0.25; **U: testnet faucet (3.4.1.4), mainnet funding (3.4.1.5), Konclave decision (4.1.2.3)** | First console batch on regtest; funds available or fallback declared |
| 09-27 → 09-28 | Auto-issuance (3.3.6.1); post v0 to zips #387 + forum (3.3.3.4) — 1.5 | Public receipt page (3.3.6.2); weekly update video 1 (5.1.1.3); Discord announcement (4.1.2.4) — 1.5; **U: domain (4.1.1.2)** | First console-issued receipt on regtest; format posted; video 1 |
| 09-29 → 09-30 | Audit-pack page + exports (3.3.6.3) — 1.5 | Konclave adapter (3.3.3.1); Solana client (3.3.2.2) — 1.0; Must 6 first public-chain issuance run (budget 0.5) | Konclave adapter draft for the 09-29 outreach |
| 10-01 → 10-03 | Well-known keys (3.3.3.3); Solana program (3.3.2.1); devnet deployment (3.3.2.3); Zallet adapter (3.3.5.5); Zkool-on-mainnet check with the first funded batch (3.3.4.2) — 2.0 | OpenZcash export (3.3.3.2) and demo branch (4.2.1.4); pilot batches ZecHub DAO (4.2.1.1) and Zcash Brazil (4.2.1.2) — 2.0; buffer 0.25 | Devnet attestation in PROOF; first pilot batch; **10-03 cut review** |
| 10-04 → 10-07 | Should 8 prototype (3.3.4.5; cut item 7); tag v0.1.0 + release notes (4.1.1.4); NU7 re-test on 10-07 (3.3.4.4) — 2.5; `cargo audit`, secrets scan (3.4.2.3) and reproducible wasm note (3.4.2.4) in the remaining 0.5 | Description + GTM paragraph (5.1.2.2); category decision (5.1.2.4); initial upload on 10-05 (5.2.1.1); weekly update 2 on 10-05 (budget booked with video 1); 1Click leg (3.3.2.4); pitch video recording (5.1.1.1) — 2.25; Must 6 second issuance run (budget 0.5); buffer 0.25; **U: npm publish (4.1.1.3)** | Initial upload 10-05 (shift if the window opens on another day) |
| 10-08 → 10-09 | Investigations (3.3.4.1, 3.3.4.3); zips thread follow-up (4.1.2.1) — 0.75; R slack 0.75 | Technical demo video (5.1.1.2); YouTube upload + link test (5.1.1.4); grantee pilot (4.2.1.3) — 1.25; buffer 0.25; [restored only if T/PM slack appears: notifications + reconciliation (3.3.6.4)] | Final videos 10-09 |
| 10-10 → 10-11 | Freeze; no scheduled work | Freeze + form re-check (5.2.1.2); final submission (5.2.1.3) — 0.5; buffer 1.0 | Final submission 10-11; one-day buffer to 10-12 |

Per-owner scheduled totals: R 1.5 + 1.5 + 1.5 + 1.5 + 2.0 + 2.5 + 0.75 = 11.25 (matches §1); T/PM leaves after the day-one cuts 1.5 + 1.0 + 1.5 + 1.0 + 2.0 + 2.25 + 1.25 + 0.5 = 11.0 (= 12.5 − 1.0 − 0.5), plus Must 6 1.0 and buffer 2.0 (0.25 in 09-25 → 09-26, 0.25 in 10-01 → 10-03, 0.25 in 10-04 → 10-07, 0.25 in 10-08 → 10-09, 1.0 in 10-10 → 10-11) = 14.0 against 14.25, leaving 0.25 spare.

Stop-loss history: the 2026-09-25 kill criterion ("Ironwood recovery fails → Sapling fallback → withdraw 09-27") was retired on 2026-09-22 when the regtest proof landed (RSK-18).

## 4. Metrics

| Horizon | Metric | Target | How counted |
|---|---|---|---|
| By 2026-10-12 | Receipts issued on public chains (testnet/mainnet) | ≥ 15 | PROOF §6/§7 txids |
| | Real issuing organisation | ≥ 1 (ZecHub DAO or Zcash Brazil) | named in README with their consent |
| | Third-party emitter or consumer | ≥ 1 (Konclave adapter or OpenZcash demo branch) | link |
| | npm + crate downloads | ≥ 50 | registry stats |
| | Publicly posted third-party verifications | ≥ 3 | forum/X/CI links |
| | Tamper rejection | 100% (on video) | video + CI |
| +90 days | Orgs / receipts per month / integrations | 3 / 300 / 2 | console counts, integrations list |
| +12 months | Second-chain verifier pilot (Solana confidential balances or Aleo records) | 1 | pilot agreement |

Browser verification leaves no trace by design (no telemetry); adoption is counted through downloads, posts and integrations only.

## 5. Video beat sheets (English)

Pitch (≤ 3:00):
- 0:00 "Your organisation pays in Zcash. Every time someone asks 'did you really pay?', you hand over the whole wallet's viewing key."
- 0:20 Console: import 5 USD payables → lock rate → two approvals → one Ironwood transaction.
- 1:00 Recipient opens a receipt link; the browser recovers their address, amount and memo from the chain.
- 1:30 Flip one byte of the receipt → INVALID at the named stage.
- 1:50 Auditor pack of 5 receipts: total recomputed; an OpenZcash-style ledger row shows "verified".
- 2:20 Konclave user exports receipts (or the demo branch).
- 2:40 Business: seats for grant programs and DAOs + verification API; roadmap: ZIP 311 alignment, Solana attestation/confidential balances.
- 2:50 Team and founder-market fit (two sentences, U to supply).

Technical demo (2–3:00): v6 transaction parse → UFVK → external OVK → per-output OCK → `try_output_recovery_with_ock` inside wasm → tamper rejection → why not a viewing key (all-or-nothing vs per-output) → hot-custody vs external-signer modes → Solana attestation write → trade-off: outputs-only now, spend-authority later → regtest proof walk-through.

Weekly updates: 2026-09-28 and 2026-10-05, 60 s each, posted on X tagging @colosseum.

## 6. Judge answer sheet (receipt version)

| Likely asker | Question | Answer |
|---|---|---|
| Colosseum team (Clay, Michael, LBO) | "Is this a ZIP or a company? How big is the market?" | Category: the proof layer for private payments. Aleo/Toku, Tempo Zones, Canton and Solana confidential balances all ship private payments in 2026 and none has on-demand proof. Revenue: issuer seats + verification API + audit-pack hosting + licensing. Zcash is the beachhead; Solana is the first chain that consumes receipts. |
| Matty | "Another payroll tool? Konclave?" | No. Konclave/ZBooks execute payments; we are the proof layer neither has. Konclave plugs in by exporting one ock column. |
| ZODL-appointed Zcash judge | "Relation to ZIP 311?" | The outputs-disclosure subset (per-output ock) implemented on Ironwood, fields aligned, feedback posted to zips #387. Spend-authority proof needs wallet-side signing; we will propose an RPC to Zallet. |
| Jill Gunter | "Privacy vs accountability?" | Private by default, provable on demand, as one link. Under EU AMLR (2027) this is the survival property for privacy assets. |
| Arcium judges (Julian, Milian) | "Why not Arcium / Solana auditor keys?" | Auditor keys see everything per mint; we disclose per output. Complementary; the second stop is receipts for Solana confidential balances via a chain-specific primitive. |
| Nate | "Verification API idempotency and failure semantics?" | Verification is a pure, stateless, cacheable function. Issuance is idempotent on (txid, index). Unconfirmed returns pending, never invalid. |
| Jed | "Audit evidence standard, tax?" | Three-part outcome: cryptographic recovery + chain inclusion + issuer signature; totals labelled lower bound; receipts carry FMV data for 1099 totals. |
| Dean / Mitchell | "How does a DAO treasury use it?" | Every published ledger row self-verifies; audit packs replace viewing-key hand-offs. |
| Sitaram | "Recipient experience?" | No login; link opens; browser verifies locally; optional USDC-on-Solana settlement. |

## 7. Second-round review verdict (2026-09-21, ported from the private research notes)

Two independent reviews (red team and alternatives) concluded: the payables-SaaS direction was a crowded me-too; the receipt direction has a clear primitive (per-output OCK), a live pool (Ironwood) nobody had built on, verifiable evidence classes, and a defensible layer position (disclosure, not execution). Adopted 2026-09-21 with the stop-loss above and the prior-art disclosure in `docs/PRIOR_ART.md`. Odds were estimated at 3–20% for a top-10 Zcash-track finish; nothing since has moved that estimate.
