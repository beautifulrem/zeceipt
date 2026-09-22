# Plan: schedule, effort, cut order, metrics, videos, judge answers

This is the executable plan for 2026-09-22 → 2026-10-12. External milestones (posts, videos, uploads, user asks) are authoritative in `09_submission_checklist.md` §5; engineering dates are authoritative in §3 below; effort and cut rules live here. Roles: R (Rust/protocol), T (TypeScript/product), PM (product/pitch), U (user-only actions).

## 1. Effort budget (person-days)

Baseline assumes two people (R and T/PM) at one person-day each per calendar day. Person-days in the WBS column are the sums of the estimates written on the WBS leaves (`00_wbs.md`), so the two views cannot drift; `scripts/check_product_docs.py` recomputes the sums. Rows without leaves (Must 1/2/6, videos, buffer) are budget lines.

| Deliverable | WBS | Person-days | Owner | Status 2026-09-22 |
|---|---|---|---|---|
| Must 1 Receipt core incl. proofs (mainnet-read, synthetic, regtest) | 3.1.2, 3.1.3, 3.4.1 (done) | 4 | R | ✅ done (PROOF §1–§5) |
| Must 2 Format + vectors + CLI + npm package | 3.2.1, 3.2.3 (done) | 2 | R | ✅ done (publish is U) |
| Must 3 Payout console: foundations, payables, batches, execution | WBS 3.3.1, 3.3.5 | 6.0 | T 3.0 + R 3.0 | ⬜ |
| Must 4 Auto-issuance + public receipt page | WBS 3.3.6.1, 3.3.6.2 | 2.0 | R 1.0 + T 1.0 | ⬜ |
| Must 5 Audit-pack page + exports + well-known keys | WBS 3.3.6.3, 3.3.3.3 | 2.0 | T 1.5 + R 0.5 | 🟡 CLI pack done; rest ⬜ |
| Must 6 Public-chain evidence + README | 3.4.1.4, 3.4.1.5 (U) | 1 | T | 🟡 regtest done; testnet/mainnet blocked on funding (U) |
| Must 7 Solana attestation program (minimal) + 1Click fallback | WBS 3.3.2 | 1.5 | R 0.75 + T 0.75 | ⬜ |
| Should 8 Spend-authority proof prototype (ZIP 311 spends half) | WBS 3.3.4.5 | 2.0 | R | ⬜ (first to cut) |
| Should 9 Konclave / OpenZcash adapters | WBS 3.3.3.1, 3.3.3.2 | 1.5 | T | ⬜ |
| Should 10 Format post to zips #387 + forum | WBS 3.3.3.4 | 0.5 | R | ⬜ (2026-09-27) |
| Should 11 Notifications + reconciliation view | WBS 3.3.6.4 | 1.0 | T | ⬜ (cut order item 2) |
| Videos ×2 + weekly updates ×2 | 5.1.1 | 2 | PM | ⬜ |
| Buffer | — | 3 | — | |
| **Total** | | **28.5** | | Capacity: 2026-09-22 → 10-11 = 20 days × 2 people × 0.75 efficiency = 30 person-days; slack **1.5** |

Open work at 2026-09-22: 28.5 − 6 (Must 1, 2) = **22.5 person-days** for two people, i.e. the plan only closes if the cut order is applied at the 10-03 review or earlier. Slack of 1.5 pd means any Must item slipping more than one day triggers a cut immediately, not at 10-03.

### 1.1 Solo branch (headcount unconfirmed, WBS 2.4.3.3; RSK-19)

Every commit to date has one author. If a second person is not confirmed by 2026-09-24, this branch replaces the baseline from that day. Scaling factor 1.6 on R/T work; capacity 20 days × 1 × 0.75 = **15 person-days**. AI-assisted implementation is the working mode but is not counted as capacity.

| Kept | Leaves | Unscaled pd | Scaled pd |
|---|---|---|---|
| Console minimal: scaffold, data model, CSV import, batches with single-source rate, Zkool adapter, auto-issuance, receipt page | 3.3.1.1, 3.3.1.3, 3.3.5.1, 3.3.5.2 (single source: 0.75), 3.3.5.4, 3.3.6.1, 3.3.6.2 | 5.25 | 8.4 |
| Exports: OpenZcash CSV only (part of 3.3.6.3); audit packs stay CLI-only | 3.3.6.3 (part) | 0.5 | 0.8 |
| Must 6 public-chain evidence + README (blocked on U funding) | 3.4.1.4, 3.4.1.5 | 1.0 | 1.6 |
| Solana hook: 1Click ZEC→USDC leg only | 3.3.2.4 | 0.5 | 0.8 |
| Videos ×2 + weekly updates ×2 | 5.1.1 | 2.0 | 3.2 |
| **Total** | | 9.25 | **14.8** |

Dropped in the solo branch (in this order, all recoverable if slack appears): Should 8, Should 11, Should 9, Should 10 (zips post, 0.8 scaled — first to add back), auth/roles UI (single operator with an env token; 3.3.1.2), API stub (3.3.1.4), approvals UI (single approver; HMAC still recorded; 3.3.5.3), Zallet and ZIP-321 adapters (3.3.5.5, 3.3.5.6), audit-pack page and QBO/Xero/1099 exports (rest of 3.3.6.3), well-known keys (3.3.3.3), Solana program (3.3.2.1–3), buffer. Submission category then moves to Developer Infrastructure (`09_submission_checklist.md` §1).

## 2. Cut order (two-person baseline; first cut → last cut)

1. Should 8 spend-authority prototype (3.3.4.5)
2. Should 11 notifications + reconciliation (3.3.6.4)
3. Should 9 Konclave/OpenZcash adapters (3.3.3.1, 3.3.3.2; keep the CSV import)
4. Public ledger page (FLOW-5; no leaf, part of 3.3.6.2 stretch)
5. Audit-pack page (keep the CLI pack; part of 3.3.6.3)
6. Two-source rate lock → single source (part of 3.3.5.2)
7. Must 7 Solana program (3.3.2.1–3) → 1Click leg only (3.3.2.4)

Never cut: Must 1, 2, 4, 6. Decision point: 2026-10-03 status review (RSK-6, RSK-7), or immediately when any Must item is more than one day behind §3.

## 3. Day-by-day schedule (authoritative for engineering dates)

Columns follow the WBS owner letters: the R column lists only R-owned leaves, the T/PM column only T/PM/U-owned leaves (`scripts/check_product_docs.py` verifies this). Fixed external dates come from `09_submission_checklist.md` §5.

| Date | R | T / PM (U in bold) | Milestone |
|---|---|---|---|
| 09-22 | Product docs; review rounds | Product docs; funding ask to U | Product/research phase closed |
| 09-23 | Data model + migrations (3.3.1.3); API routes (3.3.1.4) | Stack scaffold + custody config (3.3.1.1); auth/roles (3.3.1.2); forum post draft | Console skeleton runs locally |
| 09-24 | Zkool adapter on regtest (3.3.5.4) | Payables + CSV import (3.3.5.1); batches + rate lock (3.3.5.2); **U: push repo, CI green, forum post (4.1.1.1, 4.1.2.2)** | Repo public; first console batch on regtest |
| 09-25 | ZIP-321 adapter (3.3.5.6); **funding check (RSK-3 trigger)** | Approvals with HMAC (3.3.5.3); **U: testnet faucet (3.4.1.4)** | Funds available or fallback declared |
| 09-26 | Auto-issuance (3.3.6.1) | Public receipt page (3.3.6.2); **U: mainnet funding (3.4.1.5), Konclave decision (4.1.2.3)** | First console-issued receipt on regtest |
| 09-27 | Well-known keys (3.3.3.3); post v0 to zips #387 + forum (3.3.3.4) | Audit-pack page + exports (3.3.6.3) | Format posted |
| 09-28 | Bug fixes from the first batches (no leaf; buffer) | Exports cont. (3.3.6.3); weekly update video 1 (5.1.1.3); pilot outreach (4.2.1.1, 4.2.1.2); **U: domain (4.1.1.2)** | Video 1 posted |
| 09-29 → 09-30 | Solana program (3.3.2.1); devnet deployment (3.3.2.3); Zallet adapter (3.3.5.5) | Solana client (3.3.2.2); 1Click leg (3.3.2.4); Konclave outreach | Devnet attestation in PROOF |
| 10-01 → 10-03 | Should 8 prototype (3.3.4.5; cuttable) | Konclave/OpenZcash adapters (3.3.3.1, 3.3.3.2); notifications + reconciliation (3.3.6.4); first pilot batch (4.2.1.1) | **10-03 cut review** |
| 10-04 | `cargo audit`, secrets scan, pin check (3.4.2.3); reproducible wasm note (3.4.2.4) | Video scripts; README pass; **U: npm publish (4.1.1.3)** | — |
| 10-05 | Security self-review (3.4.2.3 cont.) | Weekly update 2; initial submission upload (5.2.1.1) — shift if the window opens on another day | Initial upload |
| 10-06 → 10-09 | NU7 testnet re-test after 10-06 (3.3.4.4); vectors/doc completion | Record pitch + technical videos (5.1.1.1, 5.1.1.2, 5.1.1.4) | Final videos 10-09 |
| 10-10 | Freeze | Form field re-check (5.2.1.2) | — |
| 10-11 | — | Final submission (5.2.1.3) | One-day buffer to 10-12 |

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
