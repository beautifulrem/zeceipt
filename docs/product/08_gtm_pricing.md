# Go-to-market and pricing

## 1. Segments and sequence

1. **Zcash grant and bounty programs** (P1): ZecHub DAO (weekly bounties), FPF/ZCG (1,015-row public ledger), ZF grants. Value: verifiable public ledger; auditor packs. Channel: forum post + ZecHub Discord + OpenZcash "verified" demo branch.
2. **Zcash-native teams and DAOs** (P2): Zcash Brazil (Konclave), Shielded Labs, ZODL contractors, grantee teams. Channel: Konclave CSV adapter; direct outreach to Konclave's author.
3. **Developers** (P5): crates + npm + vectors; zips #387 post; ZecHub wiki page.
4. **Post-hackathon**: compliance/verification API for exchanges and KYT vendors; second chain: the same envelope and verification UX over a chain-specific disclosure primitive (Solana confidential balances use per-mint ElGamal auditor keys, not per-output keys `[R41]`; a per-transfer disclosure there needs its own primitive and is research, not a port).

## 2. Launch sequence (dates)

Dates here are a subset of the single timeline in `09_submission_checklist.md` §5; if they ever disagree, §5 wins.

| Date | Action | Owner |
|---|---|---|
| 2026-09-24 | Forum post "Shielded payment receipts: looking for one pilot" with demo + regtest proof | PM |
| 2026-09-24 | Push repo, enable CI | U |
| 2026-09-27 | Post format v0 + vectors to zips #387 (design test, public timestamp) | R |
| 2026-09-28 | Register `zeceipt.xyz`, host demo page | U |
| 2026-09-28 | Weekly update video 1 (60 s, English) on X, tag @colosseum | PM |
| 2026-09-30 | Konclave author outreach with adapter PR draft (adapter lands 09-30, WBS 3.3.3.1) | PM/U |
| 2026-10-01 | First pilot batch (ZecHub bounties or a grantee team) on testnet/mainnet | PM |
| 2026-10-05 | Weekly update 2; initial submission upload | PM |
| 2026-10-10 | `npm publish @zeceipt/verify` (the day after audit, secrets scan and the v0.1.0 tag) | U |
| 2026-10-11 | Final submission | PM |

## 3. Pilot candidates (ranked by reachability)

| Candidate | Why | Ask | Status |
|---|---|---|---|
| ZecHub DAO | weekly bounties, open community, funded by FPF `[R4]` | issue receipts for one week of bounties | ⬜ |
| Zcash Brazil (Konclave) | already runs shielded payroll; ambassador also maintains OpenZcash `[R10]` `[R5]` | attach receipts to their public ledger | ⬜ |
| One ZCG grantee team | pays subcontractors in ZEC | run one batch | ⬜ |
| OpenZcash | ledger consumer | verified column demo branch | ⬜ |

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
