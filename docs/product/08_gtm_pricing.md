# Go-to-market and pricing

Rewritten 2026-09-30 for source-of-funds dossiers (`13_pivot.md`; appraisal round 1, D21). The receipts-era plan (grant programs, payout pilots, a $79/month team tier) is in this file's history; the building blocks it priced are in `docs/building-blocks.md`. Every figure below is either a cited source or marked as an assumption. No reviewer has paid for, or signed a letter of intent for, a dossier check: that is the main risk `[R137]`, and the schedule in §2 exists to test it.

## 1. Segments and channel order

Two sides. **Holders** make dossiers, and never pay. **Reviewers** (exchange compliance teams, OTC desks, bridges, lenders, and the lawyers who argue held-deposit appeals) check them, and pay above a free tier. A dossier sent to a reviewer is the sales touch: the holder brings the reviewer to the product, as a signed PDF brings a counterparty to e-signature.

Channels, in the order they are worked:

1. **The wallet button** (Zodl, Zingo): "Export source-of-funds dossier". The wallet already holds the UFVK and the transaction list, and `buildDossier` runs locally (issue drafts: `docs/outreach/wallet-integration.md`). First, because it reaches holders at the moment a reviewer asks, and a wallet team can say yes without a compliance process. Zodl already changed its documentation after the NEAR Intents hold (forum /t/57497/9; `zcash-demand.md` §2.4 rates its motive "medium, inferred") `[R137]`.
2. **Held-deposit appeals.** The public cases: the $589k NEAR Intents hold (/t/57497, 67+ days by 09-25), Kraken's EDD emails (/t/55347), Binance's refunds after 32 working days (/t/47667) `[R137]`. The holder or their lawyer sends a dossier with the appeal, and the reviewer on the other side meets the product. The pain is the highest here, and the case is public, so a result can be shown.
3. **OTC desks.** One desk decides for itself, trades bilaterally in size (ZEC is over $1,000, /t/57497/14), and needs a source-of-funds file per counterparty. Fewer approvals than an exchange.
4. **Small exchanges** that still list ZEC. A compliance lead can adopt a check without a procurement cycle, and an exchange that also sends shielded withdrawals gets the most from `dossier serve` on its own node. Large exchanges come after a reference customer; ZCG declined a compliance bridge in 2026-08 "without a specific partner asking for this approach" (/t/57119), and the same test applies here `[R137]`.

Developers are served by the open crates, `@zeceipt/verify` on npm (publishing is the owner's, WBS 4.1.1.3) and the ZIP 311 implementation report (`docs/outreach/zips-387-comment.md`).

## 2. Outreach schedule, 10-01 → 10-12

Owner steps are marked **O**: each is a public post or a message from the owner's accounts, and none happens without the owner. Drafts are in `docs/outreach/`. Dates are the plan as of 2026-09-30; `09_submission_checklist.md` §5 holds the submission's own dates, and wins if they disagree.

| Date | Action | Who |
|---|---|---|
| 10-01 | Post the reviewer pilot call on the Zcash forum (`forum-pilot-post.md`), linking the live `case/#sample` | O |
| 10-01 | Reply in the NEAR Intents hold thread (/t/57497): offer the holder a free walk-through of building a dossier, and ask what the reviewer asked for | O |
| 10-02 | File the wallet issues: zodl-ios, zodl-android, Zingo (`wallet-integration.md`) | O |
| 10-02 | Post the ZIP 311 implementation report on zcash/zips#387 (`zips-387-comment.md`), which answers ZCG's #437 advice to bring ZIP 311 to Ironwood | O |
| 10-03 | Direct messages to 5 OTC desks and 3 small exchanges that list ZEC, plus NEAR Intents' 1Click team and Gemini (the one large exchange with shielded withdrawals, `zcash-demand.md` §2.1): the sample link, the one-page API doc (`docs/api/dossier-service.md`), and one question: "would you accept this in place of screenshots?" The target list is the owner's to compile; none is contacted yet | O |
| 10-03 | Publish `@zeceipt/verify` (WBS 4.1.1.3) | O |
| 10-05 | Weekly update 2 (`weekly-update-2.md`) | O records; drafts ready |
| 10-06 | NU7 activates on testnet: re-check the live samples (the README's NU7 plan) | A |
| 10-07 | Follow up every thread once; ask each reviewer who answered for a public statement or a letter of intent | O |
| 10-08 → 10-09 | Record the pitch and the technical demo (`pitch-video.md`, `tech-demo-video.md`); put any reviewer's answer, with consent, into the pitch's "ask" line | O |
| 10-10 → 10-11 | Update §5 with the numbers as they stand; final submission | O, drafts by A |
| 10-12 | Deadline (PT) | — |

## 3. Pilot candidates

A pilot is a reviewer who checks one real dossier and tells us whether it would change their decision. Ranked by how reachable they look, not by size.

| Candidate | Why | Ask | Status (09-30) |
|---|---|---|---|
| The NEAR Intents holder (timtech, /t/57497) and whoever reviews his case | A live, public, large hold; he already sends "screenshots, addresses, hashes" and offered to sign (/t/57497/31) | Build a dossier for the funds in question and send it with his appeal | ⬜ |
| Zodl | Changed its docs after the hold; ships "Export Tax File" already | Comment on the issue draft; a button behind a flag | ⬜ |
| An OTC desk that trades ZEC | Per-counterparty source-of-funds files; one decision-maker | Check one dossier; a sentence on whether it would replace their current request | ⬜ |
| A small exchange's compliance lead | Receives EDD cases like Kraken's | Run `dossier serve` on one case, or the case page | ⬜ |
| A lawyer handling a frozen-deposit appeal | "yeah everybody is getting those" (/t/55347/7) | Attach a dossier to one appeal | ⬜ |

## 4. Pricing (draft, with its reasoning)

**What a dossier check replaces.** Today a shielded-ZEC source-of-funds case is a letter, a reply with screenshots and txids, reconciliation by hand, and often a second round (Kraken asked question 4 twice, /t/55347/9). Vendors quote EDD reports in days to weeks (7–9 business days; "weeks to months" for high-risk cases) `[R138]`. Assumption, not sourced: 2 to 8 analyst hours per shielded case at a fully loaded $60–$120 an hour, so **about $120 to $960 of analyst time per case**, before the cost of the held funds and the customer. A dossier check takes seconds (the sample: about 7 s live) and leaves one report to read and file.

**What reviewers already pay.** Chainalysis and TRM publish no list prices. Vendr's buyer data, second-hand: Chainalysis a median of $174,709 a year (range $25,742–$297,338), with KYT priced by transaction volume; TRM Labs a median of $40,000 a year (range $20,000–$48,000) `[R138]`; earlier trackers put KYT deployments at $50k–$200k a year `[R40]`. These tools score transparent flows, and treat the shielded pool as high risk; a dossier is what lets a reviewer clear a shielded case instead. So the price sits well under a KYT contract, as an add-on for one case type.

| Tier | Price | Includes | Why this number |
|---|---|---|---|
| **Holders** | Free | The builder page, the CLI, the crates and `@zeceipt/verify` (Apache-2.0) | Every dossier a holder sends is distribution. Charging the party already harmed by a hold would stop the dossier reaching the reviewer |
| **Browser review** | Free | The case page: every claim checked in the reviewer's browser, a printable case report with the dossier's sha256, a nonce generator | It costs nothing to serve (static pages, public nodes), and a reviewer has to see one work before any budget conversation |
| **Verification API**, hosted (planned; the self-hosted service exists, `dossier serve`) | **$5 per verified dossier**, first 20 a month free; or **$249 per reviewer seat a month** with 100 checks per seat | The HTTP API (`docs/api/dossier-service.md`), nonce issuance with the height it was issued at, JSON reports for the case system, a pinned node per network | $5 is 4% of the low end of the assumed analyst cost ($120), so one saved hour pays for 12 checks or more. A small exchange with 50 shielded cases a month pays $150 (after the free 20), $1,800 a year: under 5% of TRM's Vendr median |
| **Self-hosted with SLA** | **$12,000 a year** per legal entity, unlimited checks | The Docker image run on the reviewer's own node or air-gapped (`--raw-tx-dir`), next-business-day support, and upgrade releases for network upgrades within 5 business days of the Zcash crates releasing them | The code is open, so what is sold is timeliness and an answer when something breaks. NU7 shows why: from 11-05, every build refuses new mainnet transactions until someone ships the upgrade. $12,000 is under half of Chainalysis' Vendr low end and under a third of TRM's median |

Numbers to test in the conversations of §2, not commitments: a reviewer's answer to "what does one of these cases cost you today?" replaces the assumption above, and the tiers move with it. No price is published on the site until one reviewer has confirmed the order of magnitude.

## 5. Messaging

- Headline: Prove where your shielded ZEC came from, without handing over your viewing key.
- For reviewers: a source-of-funds file that checks itself against the chain, with control proved by the holder answering your nonce.
- For holders: answer the EDD letter without deshielding and without giving away your wallet's history.
- Proof points (countable): claims verified on a public chain (12 of 12 on testnet, PROOF §8), forgeries refused, reviewers who checked a real dossier, wallets that export one.
- What we are not: not a KYT score, not an identity check, not a legal attestation, not an "unspent now" proof (spec §4), not a standard anyone has ratified. A forum reply to 1CAD's source-of-funds application (strahncryptography, /t/57597/2: "THE JURISDICTION HAS NOT DEFINED IT. You cannot define it!"; ZCG declined 1CAD on 09-30) applies to any "standard" pitch, so the pitch is "turn the manual self-proof holders already send into evidence a reviewer can check" `[R137]` `[R138]`.

## 6. Metrics

Reported as they stand on the day, with no rounding up (the solo plan's rule, `11_plan.md` §4).

| Metric | 09-30 | By submission (10-11), target | 90 days, target |
|---|---|---|---|
| Reviewers who checked a real dossier and answered | 0 | 3 | 5 |
| Public statements or letters of intent from a reviewer | 0 | 1 | 3, one of them paid or in a paid pilot |
| Held-deposit holders who built a dossier (any network) | 0 | 1 | 5 |
| Wallet integrations | 0 (issues drafted) | issues filed, one maintainer reply | one merged, or behind a flag |
| Real dossiers on mainnet | 0 (testnet: 2, PROOF §8) | 1, if the owner funds it | 10 verified by pilots (reported by them; the service keeps no count) |
| ZIP 311 report | drafted | posted | a reply from a ZIP author or protocol engineer |
| `@zeceipt/verify` downloads | not published | reported as they stand | reported as they stand |
