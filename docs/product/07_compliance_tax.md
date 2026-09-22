# Compliance and tax notes

Zeceipt is not tax software and does not file anything. It records, per payment, the facts a payer or recipient needs, and produces exports. This note states what is recorded and why. Not legal advice.

## 1. United States

- Contractors: the fair market value of digital assets received for services, in USD as of the date of receipt, is self-employment income (IRS FAQ 60) `[R25]`. Employees: FMV at receipt is wages subject to withholding and reported on W-2 (FAQ 61) `[R25]`.
- Information reporting: for payments made after 2025-12-31 the Form 1099-NEC/MISC threshold is **$2,000** (previously $600), indexed for inflation from 2027, and the backup-withholding trigger is aligned to $2,000 (P.L. 119-21 §70433, amending IRC §6041(a), §6041A(a)(2), §3406(b)(6)) `[R26]`. Practitioner interpretation, not primary source: aggregate per payee per calendar year; e-file when filing ≥ 10 information returns; IRIS replaces FIRE for the 2027 filing season; some states keep $600 (e.g. Mississippi, Wisconsin) `[R26]`.
- Payer's own gain/loss on disposing ZEC at payment is a separate event (holding period matters) `[R26]`.

What Zeceipt records per payment: USD amount (payable), ZEC amount, rate with two sources and timestamp, confirmation date/height, recipient reference, receipt link. What it exports (baseline plan; dropped under the solo branch, NFR-9): per-recipient calendar-year totals with a `threshold_reached` flag (default $2,000, configurable) (`05_data_model_api.md` §3.4).

## 2. Fair-market-value policy

- Rate locked at approval from two sources (Kraken ZEC/USD, CoinGecko), stored with the timestamp; the execution-time rate is also recorded; both appear in exports so an accountant can choose the method and apply it consistently (the "reasonable, consistently applied" standard in practitioner guidance `[R26]`).
- Deviation > 3% between lock and execution blocks execution until re-quoted (REQ-CON-4).

## 3. European Union

- AMLR (Regulation 2024/1624) Art. 79 applies to credit/financial institutions and CASPs from 2027-07-10: no anonymous accounts and no anonymity-enhancing coins at regulated providers; self-custody and peer-to-peer transfers are not prohibited; Zcash's treatment (transparent pool + viewing keys) awaits EBA technical standards `[R23]`.
- Product stance: Zeceipt makes shielded payments *provable on demand*, which is the property regulated counterparties will ask for; receipts and audit packs are the artefacts, viewing keys are never required. TRM Labs lists per-transaction disclosure among recognised compliance mechanisms `[R23]`.
- Out of scope: Travel Rule (IVMS101) messaging between VASPs; a separate ZCG application (declined) proposed such a bridge (noted in the private research archive; not pursued).

## 4. Privacy commitments (product-level)

- Only per-output OCKs are ever disclosed; UFVK/OVK stay with the issuer; change outputs excluded by default.
- Recipients are told that a receipt reveals their diversified address for that payment; fresh addresses per payment are recommended (spec §9).
- Hosted verification pages state which node they query; CLI offers an offline mode (`--raw-tx-file`/`--raw-tx-dir`) and a custom endpoint override today; block-range and Tor modes are planned (REQ-CLI-7).
- Data retention in the console: receipts and batch records kept for the organisation's accounting period; OCKs encrypted at rest; audit log append-only.

## 5. Open items

- Non-US payer record-keeping requirements (UK, EU member states) — noted, not researched (WBS 1.2.4.4).
- Whether public grant programs want the recipient's USD total exposed in audit packs (configurable redaction to add if a pilot asks).
