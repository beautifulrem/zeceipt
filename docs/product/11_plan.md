# Plan: schedule, effort, cut order, metrics, videos, judge answers

This is the executable plan for 2026-09-22 → 2026-10-12. Dates in `09_submission_checklist.md` §5 are the single authoritative timeline; this file adds effort, owners and cut rules. Roles: R (Rust/protocol), T (TypeScript/product), PM (product/pitch), U (user-only actions).

## 1. Effort budget (person-days)

Assumes two people at one person-day each per calendar day; a single-person team scales the R/T columns by 1.6 and applies the cut order earlier.

| Deliverable | Person-days | Owner | Status 2026-09-22 |
|---|---|---|---|
| Must 1 Receipt core incl. proofs (mainnet-read, synthetic, regtest) | 4 | R | ✅ done (PROOF §1–§5) |
| Must 2 Format + vectors + CLI + npm package | 2 | R | ✅ done (publish is U) |
| Must 3 Payout console (thin) | 5 | T | ⬜ |
| Must 4 Auto-issuance + public receipt page | 2 | T | ⬜ |
| Must 5 Audit pack page + exports + well-known keys | 2 | R 1 + T 1 | 🟡 CLI pack done; page/exports/well-known ⬜ |
| Must 6 Public-chain evidence + README | 1 | T | 🟡 regtest done; testnet/mainnet blocked on funding (U) |
| Must 7 Solana attestation program (minimal) | 1 | R | ⬜ |
| Should 8 Spend-authority proof prototype (ZIP 311 spends half) | 2 | R | ⬜ (first to cut) |
| Should 9 Konclave / OpenZcash adapters | 1.5 | T | ⬜ |
| Should 10 Format post to zips #387 + forum | 0.5 | R | ⬜ (2026-09-27) |
| Videos ×2 + weekly updates ×2 | 2 | PM | ⬜ |
| Buffer | 3 | — | |
| **Total** | **26** | | Calendar: 2026-09-22 → 2026-10-11 = 20 days × 2 people × 0.75 efficiency ≈ 30 person-days; slack ≈ 4 |

Remaining after the first six days of work: about 20 person-days of the 26 are still open; slack is what triggers the cut order.

## 2. Cut order (first cut → last cut)

1. Should 8 spend-authority prototype
2. REQ-CON-15 notifications, REQ-CON-16 reconciliation view (WBS 3.3.6.4)
3. Should 9 Konclave/OpenZcash adapters (keep the CSV import, cut the demo branch)
4. Public ledger page (FLOW-5)
5. Audit-pack page (keep the CLI pack)
6. Two-source rate lock → single source
7. Must 7 Solana program → 1Click ZEC→USDC leg as the Solana hook (REQ-SOL-5)

Never cut: Must 1, 2, 4, 6. Decision point: 2026-10-03 status review (RSK-6, RSK-7). Trigger: any Must item more than one day behind the schedule below.

## 3. Day-by-day schedule

| Date | R | T / PM | Milestone |
|---|---|---|---|
| 09-22 | Product docs; review round(s) | Product docs; funding ask to U | Product/research phase closed |
| 09-23 | Console data model + migrations (3.3.1.3); API routes (3.3.1.4) | Stack scaffold + auth (3.3.1.1–2); forum post draft | Console skeleton runs locally |
| 09-24 | Zkool adapter on regtest (3.3.5.4) | Payables import + batches + rate lock (3.3.5.1–2); **U: push repo, CI green, forum post** | Repo public; first console batch on regtest |
| 09-25 | ZIP-321 adapter (3.3.5.6); **funding check (RSK-3 trigger)** | Approvals with HMAC (3.3.5.3) | Testnet or mainnet funds available, or fallback declared |
| 09-26 | Auto-issuance (3.3.6.1) | Public receipt page (3.3.6.2) | First console-issued receipt on regtest |
| 09-27 | Well-known keys (3.3.3.3); **post v0 to zips #387** | Audit-pack page (3.3.6.3) | Format posted |
| 09-28 | Exports (3.3.6.3 cont.) | **Weekly update video 1**; pilot outreach (ZecHub DAO, Zcash Brazil) | Video 1 posted |
| 09-29 → 09-30 | Solana program + devnet (3.3.2.1–3) | Solana client (3.3.2.2); Konclave outreach | Devnet attestation in PROOF |
| 10-01 → 10-03 | Should 8 prototype (cuttable) | Konclave/OpenZcash adapters; first pilot batch | **10-03 cut review** |
| 10-04 | Bug fixes; `cargo audit`; pin check | Video scripts; README pass | — |
| 10-05 | Security self-review | **Weekly update 2; initial submission upload** (shift if the window opens on another day) | Initial upload |
| 10-06 → 10-09 | Vectors/doc completion; NU7 testnet re-test after 10-06 | Record pitch + technical videos | Final videos 10-09 |
| 10-10 | Freeze | Form field re-check | — |
| 10-11 | — | Final submission | One-day buffer to 10-12 |

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
