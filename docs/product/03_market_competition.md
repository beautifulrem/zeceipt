# Market and competition

## 1. Market sizing (top-down, labelled)

| Layer | Definition | Figure | Basis |
|---|---|---|---|
| TAM (category) | "Private payments that must remain provable on demand" across privacy chains and confidential stablecoin rails | Category forming in 2026: Aleo+Toku private stablecoin payroll, Tempo Zones, Canton private payroll, Solana confidential balances re-enabled; regulators (TRM) list per-transaction disclosure as a compliance mechanism; EU AMLR makes selective disclosure a survival condition for privacy assets from 2027-07 `[R23]` | qualitative; no reliable dollar figure |
| Seat TAM (upper bound) | Organisations paying contributors on-chain: ~2,000 DAOs with treasuries (DeepDAO scale, mostly transparent stablecoins today), ~200 ecosystem grant programs, ~2,000 crypto-native businesses on payroll tools (5% of Deel's 40k customers) → ~4,000 orgs × $1k–3k ACV | **$4M–$12M / year** | estimate; upper bound, no penetration assumed |
| SAM (Zcash first) | Organisations paying in shielded ZEC that must account publicly | ZCG: 1,015 rows, $23.3M paid, 414.7K ZEC `[R5]`; FPF: 62 milestones + 129 bounties per quarter `[R4]`; Zcash Brazil / Shielded Labs / grantee teams | ~$5–10M/yr of disbursements; tens of orgs |
| SOM (12 months) | Pilots + first paying orgs | 3 paying orgs, 1 public ledger consumer, 2 integrators | targets in KB `20` §17.8 |

Multiplier thesis: seats start it; verification API and compliance-vendor licensing (enterprise KYT contracts are typically six figures per year) plus per-chain reuse of the same format scale it (KB `20` §17.3).

## 2. Pricing benchmarks

| Vendor | Model | Numbers | Ref |
|---|---|---|---|
| Request Finance | subscription per org | Starter $42/mo (1 seat), Growth $250 (5 seats, QuickBooks/Xero), Pro $500 (20 seats), Scale $1,040 (NetSuite); stablecoin payouts free; off-ramp 0.5–1% + $10/$30 | `[R27]` |
| Rise | per worker | Contractor $49/mo; AOR $299; EOR $399/employee/mo; W-2/1099 included in US payroll | `[R28]` |
| Bitwage | freemium per employee | Premium $7.99/employee/mo; 0.5% + $0.50 ACH-debit funding | `[R29]` |
| Toku | per worker, quote-based | stablecoin payroll included; ~25 bps off-ramp; tax-ready W-2/1099/TDS per cycle | `[R30]` |

Implication for Zeceipt (see `08_gtm_pricing.md`): price like a Request Finance add-on (tens to low hundreds per month per org), not like an EOR.

## 3. Competitor and adjacent-product matrix

Legend: ● has it · ○ partial · — none. Columns are the capabilities a judge or buyer will compare.

| Product | Live pool | Batch payouts | USD-denominated | Approvals | Per-payment verifiable receipt | Audit pack / lower-bound | Accounting export | Active | Ref |
|---|---|---|---|---|---|---|---|---|---|
| **Zeceipt (this)** | Ironwood (+Orchard/Sapling) | console ⬜ | console ⬜ | console ⬜ | ● (OCK, signed, challenge) | ● | planned (OpenZcash/QBO/Xero) | yes | PROOF |
| Konclave | Ironwood | ● one tx N memos | — | ● FROST t-of-n | — (self-attested ledger) | — | ○ CSV ledger | yes, users | `[R10]` |
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
| Solana confidential balances | Solana | — | — | — | ○ auditor key per mint (all-or-nothing) | — | — | re-enabled 2026-06 | KB `21` §四 |

Reading: nobody on Zcash (or elsewhere in the table) combines chain-verifiable per-payment receipts with audit packs and accounting exports; the closest shipped analogue is Monero's per-transaction proof, which has no batch, memo or accounting layer.

## 4. Positioning statement

For organisations that pay people in shielded ZEC and must prove it, Zeceipt is the disclosure layer that turns each payment into a receipt anyone can verify against the chain, without handing over a viewing key. Unlike payout tools (Konclave, ZBooks) that only keep an internal ledger, and unlike viewing-key exports that reveal everything, Zeceipt discloses exactly one output per receipt and packages receipts into lower-bound audit packs and accounting exports. Execution tools are integrations, not competitors.

## 5. Threats to watch (weekly rescan, WBS 1.1.2.4)

- Konclave adding receipts (they have the OVK and the ledger; adding an ock column is a day of work) — mitigation: ship the format and offer the adapter first (REQ-INT-1).
- ZCG #437 being funded and producing an "official" SDK in 2027 — mitigation: align fields, post to zips #387, position as the implementation.
- Zenvelope's group envelopes — different primitive (link payments), not a receipt; monitor.
