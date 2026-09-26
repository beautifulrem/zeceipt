# Go-to-market and pricing

## 1. Segments and sequence

1. **Zcash grant and bounty programs** (P1): ZecHub DAO (weekly bounties, whose payments FPF sends `[R4]`), ZCG (a 1,016-row ledger mirrored on OpenZcash `[R105]`), ZF grants. Value: verifiable public ledger; auditor packs. Channels in the solo schedule (`11_plan.md` §8): the forum pilot call, and an OpenZcash-compatible export (built, slices X1–X2c). The OpenZcash "verified" demo branch is infeasible (no public source) and a ZecHub Discord announcement was not restored (slice D10b).
2. **Zcash-native teams and DAOs** (P2): Zcash Brazil (Konclave), Shielded Labs, ZODL contractors, grantee teams. Channels: a CSV import of Konclave's `label,address,value[,memo]` format (planned, slice D10b; the Konclave-side adapter was dropped); contacting Konclave's author is the user's decision (WBS 4.1.2.3).
3. **Developers** (P5): crates + npm (publishing is the user's) + vectors; the zips #387 implementation report (drafted; posting is the user's option); a ZecHub wiki page (not scheduled).
4. **Post-hackathon**: compliance/verification API for exchanges and KYT vendors; second chain: the same envelope and verification UX over a chain-specific disclosure primitive (Solana confidential balances use per-mint ElGamal auditor keys, not per-output keys `[R41]`; a per-transfer disclosure there needs its own primitive and is research, not a port).

## 2. Launch sequence (dates)

Dates here are a subset of the single timeline in `09_submission_checklist.md` §5, re-derived from `11_plan.md` §8 on 2026-09-26 (slice D10c); if they ever disagree, §5 wins.

| Date | Action | Owner |
|---|---|---|
| 2026-09-28 | Push the repo, enable CI; then post the forum call "Shielded payment receipts: looking for one pilot" (drafted) | U |
| 2026-09-28 | Weekly update 1 (60 s), most likely on the Arena dashboard (inferred from `isCurrentWeekUpdateSubmitted`; needs the project registered), with X tagging @colosseum as an extra; script and footage ready (`docs/outreach/weekly-update-1.md`) | U records and posts; PM prepares |
| 2026-10-01 | Register `zeceipt.xyz`, host the demo page | U |
| 2026-10-01 → 10-03 | First pilot batch, issued by the pilot's sender (FPF for ZecHub's bounties, or a payer from the forum call) | PM, with the pilot |
| 2026-10-05 | Weekly update 2; initial submission upload on the window-open day | U records and posts; PM uploads |
| 2026-10-10 | `npm publish @zeceipt/verify` (the day after the security review) | U |
| 2026-10-11 | Final submission | PM |

## 3. Pilot candidates (ranked by reachability)

A pilot needs the wallet that sends the payments: receipts are issued from that wallet's viewing key (PROOF §5), so the issuer is whoever pays.

| Candidate | Why | Ask | Status |
|---|---|---|---|
| ZecHub DAO, with FPF as the sender | weekly bounties, open community; FPF sends the payments `[R4]` | FPF issues receipts for one week of ZecHub bounties | ⬜ (after the forum call) |
| Zcash Brazil (Konclave) | keeps its treasury on Konclave since 2026-08-29 `[R10]`; our KB lists its treasury lead as OpenZcash's maintainer (unverified, KB `12_sources_and_gaps.md`) | one batch paid from its wallet, with receipts for its public ledger | ⬜ |
| One ZCG grantee team | pays subcontractors in ZEC | run one batch | ⬜ |
| OpenZcash | ledger consumer | the OpenZcash-compatible export (built, slices X1–X2c); the "verified" demo branch is infeasible (no public source) | ⬜ (ask whether the format is useful) |

## 4. Pricing (draft, benchmarked)

| Tier | Price | Includes | Benchmark logic |
|---|---|---|---|
| Open source | free | crates, npm, CLI, format, vectors | dev adoption; grant-fundable public good |
| Issuer | $0 up to 20 receipts/month | hosted receipt pages, one org, one issuer key | free entry tier (Bitwage's per-employee pricing `[R29]` is unverified, second-hand; the free tier stands on its own) |
| Team | $79/month | 500 receipts/month, audit-pack hosting, exports (OpenZcash/QBO/Xero/1099 totals), 5 seats | below Request Finance Growth ($250) since we are an add-on, above Rise's $49/contractor unit `[R27]` `[R28]` |
| Organisation | from $299/month | unlimited receipts, well-known key binding, verification API quota, priority support | Request Finance Pro/Scale range `[R27]` |
| Verification API / licensing | usage-based; enterprise licence | compliance vendors, exchanges, ledgers | commercial KYT/compliance deployments quoted at $50k–$200k/yr and above as the ceiling reference `[R40]` |

Optional revenue: 1Click affiliate fee on ZEC→USDC settlement (Could).

## 5. Messaging

- Headline: Private outside, provable per payment.
- Sub: Every shielded payout becomes a receipt anyone can verify against the chain — without a viewing key.
- Proof points (countable): receipts issued, packs verified, third-party verifications, integrations.
- What we are not: not a wallet, not a vault, not an EOR, not a full ZIP 311.

## 6. Metrics (detail in `11_plan.md` §4)

Baseline plan, pre-submission: ≥ 15 receipts on public chains (blocked on funding), ≥ 1 real issuing org, ≥ 1 third-party emitter/consumer, npm/crate downloads ≥ 50, ≥ 3 publicly posted verifications; 90 days: 3 orgs / 300 receipts / 2 integrations. Solo branch: ≥ 3 receipts, 1 org, 1 public external verification, ≥ 20 downloads; 90 days: 2 / 100 / 1 (`11_plan.md` §4).
