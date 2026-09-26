# Personas and jobs to be done

Evidence-based: every persona cites public statements or data (`[Rn]` in `10_research_log.md`). No interviews have been run yet (WBS 1.3.2.3/1.3.2.4 open).

## 0. Problem statement and why now

Problem: organisations that pay people in shielded ZEC cannot prove a single payment without handing over a viewing key that reveals every payment, so public ledgers stay "trust me" `[R5]`, recipients get no receipt, and auditors are asked for all-or-nothing access `[R3]`. Payout tools keep an internal ledger but produce no chain-verifiable artefact `[R10]` `[R11]`.

Why now: the Ironwood pool activated on 2026-07-28 and the Orchard pool is sealed, so every new shielded payment uses a domain no receipt tool had implemented `[R20]`; ZIP 311 defines the disclosure primitive but has no implementation and the funded SDK application targets 2027 `[R7]` `[R8]`; the Zallet/Zaino stack replaces zcashd in the same window `[R19]` `[R34]`; EU AMLR makes on-demand provability the condition for privacy assets at regulated counterparties from 2027-07 `[R23]`; only one major exchange withdraws to shielded addresses, so most organisational payments still start transparent and need a private-but-provable path `[R24]`.

## P1 — Grant-program operations (primary buyer)

- Who: the FPF/ZCG staff who pay milestones and bounties; Zcash Foundation grants; ZecHub DAO bounty admin.
- Evidence: 62 milestone payouts and 129 bounty payments in one quarter, processed weekly within four hours of notification `[R4]`; the ZCG decision-support prototype lists payment requests/approvals, KYC and writeback as not implemented `[R6]`; OpenZcash mirrors a 1,015-row spreadsheet whose rows are not chain-verified `[R5]`.
- Jobs: (1) pay approved USD amounts in shielded ZEC at a recorded rate; (2) prove publicly that each row was paid without exposing the treasury wallet; (3) produce year-end per-recipient USD totals; (4) answer "did you pay me?" without a viewing key.
- Pains: state scattered across sheet, forum, GitHub, wallet; no receipt to give recipients; public ledger is trust-me.
- Success: every published row has a receipt link; a Zeceipt audit pack replaces viewing-key hand-offs.

## P2 — DAO / team treasurer (secondary buyer)

- Who: Zcash Brazil (runs payroll on Konclave since 2026-08-29 `[R10]`), Shielded Labs, ZODL contractors, grantee teams paying subcontractors.
- Jobs: pay N people in one shielded transaction; keep amounts private from the public; give each person a payslip-like proof; export to the accountant.
- Pains: Konclave and similar tools produce an internal ledger only `[R10]`; accountants want files they can import `[R32]`; unsigned memos are not proof.
- Success: receipts attached to each payslip row; QuickBooks/Xero import works.

## P3 — Recipient (contributor, grantee, employee)

- Who: bounty hunters, grant recipients, remote contributors paid in shielded ZEC.
- Evidence: IRS treats FMV at receipt as income `[R25]`; recipients need USD value and date per payment; the forum thread notes "the auditor needs proof" `[R3]`.
- Jobs: prove income (tax, visa, loans); confirm which invoice a payment settled; optionally receive USDC on Solana instead.
- Pains: screenshots are not evidence; wallets show memos but nothing exportable.
- Success: one link per payment that any third party can verify; PDF/JSON export.

## P4 — Auditor / accountant

- Who: external accountants of DAOs and grant programs; funders auditing a grantee.
- Evidence: "accepting payment is the easy part… the bookkeeper needs records and the auditor needs proof" `[R3]`; today the only tool is handing over a full viewing key (all-or-nothing) `[R3]`.
- Jobs: verify a set of payments and their total; confirm memo references; keep the rest of the wallet private.
- Pains: viewing keys over-disclose; spreadsheets under-prove.
- Success: an audit pack with a lower-bound total that verifies offline; challenge-bound receipts for directed proofs.

## P5 — Integrator (developer)

- Who: Konclave, ZBooks, ZecLedger, BTCPay/Zkool users, exchanges' compliance tooling teams.
- Evidence: Konclave exports an itemized CSV `[R10]`; ZecLedger applied for a retroactive grant as a read-only accounting CLI `[R9]`; ZCG #437 asks for exactly a receipts SDK `[R8]`.
- Jobs: emit receipts after broadcast; verify receipts in CI or in a browser; avoid re-implementing Zcash crypto.
- Pains: no format, no library, ZIP 311 unfinished `[R7]`.
- Success: `cargo add zeceipt-core` / `npm i @zeceipt/verify` plus vectors.

## P6 — Public-ledger consumer

- Who: OpenZcash maintainer, community dashboards, journalists, coinholders voting on grants.
- Evidence: OpenZcash explicitly states rows are spreadsheet-mirrored and payments are not verified on-chain `[R5]`.
- Jobs: show "verified" per row; let readers self-verify.
- Success: a `receipts.json` feed per organisation; a verified badge.

## Judges as user proxies

Colosseum judges evaluate on Functionality, Potential Impact, Novelty, UX, Open-source, Business Plan `[R1]`. The ZODL-appointed Zcash judge will test "is this real ZEC usage" `[R2]`. Answers are prepared in `11_plan.md` §6; the criterion-by-criterion map is `09_submission_checklist.md` §6.

## Prioritisation

| Persona | v0 (hackathon) | Post-hackathon |
|---|---|---|
| P1 | pilot target (ZecHub's bounties, with FPF as the sender who issues; or a payer from the forum call) | ZCG/FPF adoption via OpenZcash |
| P2 | CSV import of Konclave's format (planned; the Konclave-side adapter was dropped) | console customers |
| P3 | receipt page | PDF export, USDC settlement |
| P4 | audit pack CLI | hosted audit portal |
| P5 | crates + npm + vectors | ZIP alignment, other chains |
| P6 | OpenZcash-compatible export (planned; the demo branch is infeasible: no public OpenZcash source) | verified feeds |
