# Market and competition

## 1. Market sizing (top-down, labelled)

| Layer | Definition | Figure | Basis |
|---|---|---|---|
| TAM (category) | "Private payments that must remain provable on demand" across privacy chains and confidential stablecoin rails | Category forming in 2026: Aleo+Toku private stablecoin payroll, Tempo Zones, Canton private payroll, Solana confidential balances re-enabled; regulators (TRM) list per-transaction disclosure as a compliance mechanism; EU AMLR makes selective disclosure a survival condition for privacy assets from 2027-07 `[R23]` | qualitative; no reliable dollar figure |
| Seat TAM (upper bound) | Organisations paying contributors on-chain: 183 DAOs with a treasury above $1M on DeepDAO's own dashboard `[R38]` (a static snapshot dated 2025-11-24; the 2,461 enriched organisations are the outer bound, most without a material treasury; treasuries are mostly governance tokens/stablecoins today); ~200 ecosystem grant programs (assumption: one per major L1/L2 foundation plus sub-programs, not sourced); ~2,000 crypto-native businesses on payroll tools = 5% of Deel's 40,000+ customers `[R39]` (the 5% share is an assumption) → ~2,400 orgs × $1k–3k ACV | **$2.4M–$7.2M / year** | estimate; upper bound, no penetration assumed; arithmetic shown (183 + 200 + 2,000 = 2,383); outer bound with 2,461 DAOs would be $4.7M–$14.0M; the DAO term is stale by ten months and is the weakest input |
| SAM (Zcash first) | Organisations paying in ZEC that must account publicly (shielded where the payer chooses; whether ZCG/FPF payouts are shielded is unverified, R4) | ZCG: 1,016 rows, 825 marked paid, budgeted at $23.3M, 414.75K ZEC `[R105]` `[R5]`; FPF: 62 milestones + 129 ZecHub bounty payments per quarter `[R4]`; Zcash Brazil / Shielded Labs / grantee teams | ~$5–10M/yr of disbursements; tens of orgs |
| SOM (12 months) | Pilots + first paying orgs | 3 paying orgs at the Team tier ($79/mo) ≈ $2.8k/yr plus 1 Organisation tier ($299/mo) ≈ $3.6k/yr → **≈ $6–7k ARR**, 1 public ledger consumer, 2 integrators | targets in `11_plan.md` §4; revenue is not the 12-month goal, adoption is |

Multiplier thesis: seats start it; verification API and compliance-vendor licensing (commercial KYT/compliance deployments are quoted at $50k–$200k per year and above `[R40]`) plus per-chain reuse of the same envelope and verifier UX over chain-specific disclosure primitives scale it.

## 2. Pricing benchmarks

| Vendor | Model | Numbers | Ref |
|---|---|---|---|
| Request Finance | subscription per org | Starter $42/mo (1 seat), Growth $250 (5 seats, QuickBooks/Xero), Pro $500 (20 seats), Scale $1,040 (NetSuite); stablecoin payouts free; off-ramp 0.5–1% + $10/$30 | `[R27]` |
| Rise | per worker | Contractor $49/mo; AOR $299; EOR $399/employee/mo; W-2/1099 included in US payroll | `[R28]` |
| Bitwage | freemium per employee | Premium $7.99/employee/mo; 0.5% + $0.50 ACH-debit funding (**unverified, second-hand review sites**; confirm on bitwage.com before quoting) | `[R29]` |
| Toku | per worker, quote-based | stablecoin payroll included; ~25 bps off-ramp (**unverified**: a customer testimonial, not a price list); tax-ready W-2/1099/TDS per cycle | `[R30]` |

Implication for Zeceipt (see `08_gtm_pricing.md`): price like a Request Finance add-on (tens to low hundreds per month per org), not like an EOR.

## 3. Competitor and adjacent-product matrix

Legend: ● has it · ○ partial · — none. Columns are the capabilities a judge or buyer will compare.

| Product | Live pool | Batch payouts | USD-denominated | Approvals | Per-payment verifiable receipt | Audit pack / lower-bound | Accounting export | Active | Ref |
|---|---|---|---|---|---|---|---|---|---|
| **Zeceipt (this)** | Ironwood (+Orchard/Sapling) | ● console: one transaction per batch (RSK-21's remaining cases) | ● payables in USD at a fixed lock | ○ one approver, HMAC-bound; two approvers dropped (REQ-CON-22) | ● (OCK, signed, challenge) | ● | dropped in the solo branch (REQ-CON-14) | yes | PROOF §5d; `01` REQ-CON-3/-4/-5/-7 |
| Konclave | Ironwood | ● one tx N memos | — | ● FROST t-of-n | — (self-attested ledger) | — | ○ CSV ledger | yes, users | `[R10]` |
| Laminar | n/a (prepares intents; the wallet signs) | ● CSV → ZIP-321 intents (proposed) | — | — | ○ "Receipt Bundle": hash-linked intent manifest, integrity only; discloses nothing by default | — | — | RFC and ZCG grant application 2026 ($50k, 12 weeks); delivery **unverified** | `[R92]` |
| ZBooks | Orchard-era | ○ ZIP-321 QR | — | ● M-of-N | — | — | ○ CSV/P&L | dormant 2026-07-30 | `[R11]` |
| zecpay | Orchard-era | ● URI | ● rate lock | — | ○ SHA-256 batch receipt (not chain-verifiable) | — | — | dormant 2026-03-20 | `[R12]` |
| Zwage | unknown | ● | ● | ○ | — | — | ● Form 8949 | offline (404) | `[R14]` |
| Glasspane | Orchard (sealed) | — | — | — | ● (OCK) | ● rooms | ○ CSV | dormant 2026-07-13 | `[R13]` |
| ZecLedger | UFVK read | — | — | — | — | — | ● cost basis | grant applied | `[R9]` |
| zechledger | testnet | — | — | ○ | ○ Ed25519 capsule (app-layer) | ○ | ○ | active | `[R16]` |
| Zenvelope | Ironwood | ○ planned group envelopes | — | — | — | — | ○ CSV | active (CWF) | `[R15]` |
| OpenZcash | n/a (ledger mirror) | — | ● | — | — | — | ● CSV export | active | `[R5]` |
| Request Finance | EVM stablecoins | ● | ● | ● | ○ tx hash | — | ● QBO/Xero/NetSuite | active | `[R27]` |
| Toku / Rise / Bitwage | EVM/Solana stablecoins | ● | ● | ● | ○ payslips/tax forms | — | ● | active | `[R28]`–`[R30]` |
| Monero prove-payment | Monero | — | — | — | ● per-tx key | — | — | shipped | `[R31]` |
| Solana confidential balances | Solana | — | — | — | ○ auditor key per mint (all-or-nothing) | — | — | re-enabled on mainnet 2026-06-04 (proof program) / launch post 2026-06-10 | `[R41]` |
| ShieldGive | Sapling via a node's `z_listreceivedbyaddress` (the recipient's viewing key imported) | — | — | — | ○ a Solana NFT minted by the recipient's agent after it sees the donation (attested by that agent, not chain-verifiable by a third party; mocked in the public demo) | — | — | active (CWF Zcash track), created 2026-09-16 | `[R129]` |
| Open Zcash Merchant Payments | n/a (authenticates ZIP 321 invoices for wallets) | — | — | — | — (signs the invoice before payment; a reviewed domain/key registry with DNS TXT challenges) | — | — | alpha, created 2026-09-22 | `[R129]` |
| Zumbra | Ironwood (a Zipher fork) | — | — | ○ an agent spending policy | ○ MPP `Payment-Receipt` headers (a server's status line, not chain-verifiable) | — | — | pre-alpha, created 2026-09-21 | `[R129]` |
| Rill (zcash) | n/a (shielded ZIP 321 invoices for agent pay links) | — | — | — | — (the seller watches with a viewing key) | — | — | created 2026-09-14, last push 09-19 | `[R129]` |

Reading: nobody on Zcash (or elsewhere in the table) combines chain-verifiable per-payment receipts with audit packs and accounting exports; the closest shipped analogue is Monero's per-transaction proof, which has no batch, memo or accounting layer. Rechecked on 2026-09-28: no maintained Zcash wallet we searched (Zallet, the zcash, zingolabs, zodl-inc, Electric-Coin-Company and ZcashFoundation organisations, Zkool) implements ZIP 311 or a payment-disclosure RPC; zcashd's experimental Sprout-only ones are deprecated `[R124]`. Rescanned the same day among Zcash repositories created since 09-10: the receipt-adjacent newcomers prove a payment to the recipient's own agent (ShieldGive's NFT), sign the request before payment (Open Zcash Merchant Payments) or return a server's status (Zumbra's MPP receipts); none discloses one output so that a third party can check it on chain `[R129]`.

## 4. Positioning statement

For organisations that pay people in shielded ZEC and must prove it, Zeceipt is the disclosure layer that turns each payment into a receipt anyone can verify against the chain, without handing over a viewing key. Unlike payout tools (Konclave, ZBooks) that only keep an internal ledger, and unlike viewing-key exports that reveal everything, Zeceipt discloses exactly one output per receipt and packages receipts into lower-bound audit packs and a ledger export (the OpenZcash CSV; accounting exports are planned). Execution tools are integrations, not competitors.

## 5. Threats to watch (weekly rescan, WBS 1.1.2.4)

- Konclave adding receipts (they have the OVK and the ledger; adding an ock column is a day of work) — mitigation: ship the format and offer the adapter first (REQ-INT-1).
- ZCG #437 being funded and producing an "official" SDK in 2027 — mitigation: align fields, post to zips #387, position as the implementation.
- Zenvelope's group envelopes — different primitive (link payments), not a receipt; monitor.
- ShieldGive in the same track calls its NFT a "donation proof": a judge may compare. Its proof is the recipient's agent's attestation, where a Zeceipt receipt is checked against the chain by anyone; say so if asked, without claiming to be the only receipt `[R129]`.
- Open Zcash Merchant Payments binds merchant keys to domains through a reviewed registry, the pre-payment counterpart of the issuer binding (`/.well-known/zeceipt.json`, spec §7): a signed invoice and a receipt could share one key and domain; monitor.
- zechledger (in the matrix) calls its signed anchor a "wallet observation receipt": an operator's signed statement that it saw a txid at a height, not a disclosure a third party checks on chain; if a judge meets both terms, the difference is who has to be trusted `[R129]`.
- Hackathon history: no Zcash-specific hackathon has produced a payout-receipt winner `[R22]`; Colosseum winners share mainnet usage plus one verifiable number `[R36]` — the metric plan in `11_plan.md` §4 is built around that.
