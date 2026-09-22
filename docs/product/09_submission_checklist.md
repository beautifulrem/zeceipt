# Colosseum submission checklist

Source for fields and rules: `[R1]` (KB `04_submission`, `05_judging`). Deadline 2026-10-12 23:59 PT; window assumed to open ~2026-10-05 (confirm, WBS 1.1.1.4). One submission per team; all content in English.

## 1. Form fields

| Field | Content / decision | Status |
|---|---|---|
| Product name | Zeceipt (confirm) | 👤 |
| Description | ≤ 500 words: problem, what a receipt proves, Ironwood-native, proof log summary, integrations | ⬜ draft in §2 |
| Blockchains and tools integrated | Zcash (Ironwood, Orchard, Sapling; lightwalletd/Zaino; Zkool GraphQL); Solana (attestation program, devnet) ; NEAR Intents (optional) | ⬜ finalise after REQ-SOL |
| Category | **Payments & Remittance** (primary) — receipts are a payments artefact and the console pays; alternative Developer Infrastructure if the console is cut | ⬜ decide 2026-10-03 |
| Team members with background | names, roles, 2-line bios | 👤 |
| Team location / country | | 👤 |
| Logo / graphic | simple wordmark + receipt glyph (SVG) | ⬜ |
| GitHub repository | public URL | 👤 push |
| Presentation (pitch) video | ≤ 3 min, YouTube unlisted | ⬜ |
| Product demo video | 2–3 min technical, YouTube unlisted | ⬜ |
| Go-to-market | paragraph from `08_gtm_pricing.md` §1–§2 | ⬜ |
| isUniversityProject / isSolanaMobile | no / no | ✅ |

## 2. Description draft (English, to refine)

Zeceipt makes shielded Zcash payments provable per payment. Every output an organisation pays becomes a receipt: a small signed envelope holding that output's Outgoing Cipher Key. Anyone — the recipient, an auditor, a public ledger — recovers exactly that payment (recipient, amount, memo) from the chain in their browser, without receiving a viewing key and without learning anything else about the payer. It is the `outputs` half of ZIP 311, implemented for the live Ironwood pool, with a format, test vectors, a Rust crate, a CLI and an npm verifier. On top of it, a payout console turns USD-denominated payables into approved shielded batches (via Zkool) and issues receipts automatically, with audit packs and QuickBooks/Xero/OpenZcash exports. Proof: mainnet transactions parsed and fetched over gRPC; a consensus-valid transaction on a Zebra regtest chain issued from the sender's viewing key and verified online and offline; tamper cases fail closed. [Add: testnet/mainnet receipts once available; pilot organisation.]

## 3. Videos

- Pitch (≤ 3:00): 0:00 problem ("prove you paid without giving away the wallet") · 0:30 receipt demo in browser · 1:20 tamper rejected · 1:40 console batch → receipts → OpenZcash verified row · 2:20 business (seats, API, pilots) · 2:45 team + FMF.
- Technical demo (2–3:00): v6 parse → OVK → per-output OCK → wasm recovery → tamper → why not a viewing key → custody modes → Solana attestation write → trade-off: outputs-only vs full ZIP 311 → regtest proof.
- Weekly updates: 2026-09-28, 2026-10-05 (60 s each).

## 4. Repository readiness

- [x] README with proof, prior art, status, what is/isn't proven
- [x] `docs/PRE_EVENT_STATE.md`, `docs/PRIOR_ART.md`
- [x] Commit history inside the window (first commit 2026-09-21)
- [ ] CI green on GitHub (needs push)
- [ ] `cargo audit` clean; secrets scan
- [ ] Tag v0.1.0; release notes
- [ ] Demo page hosted (GitHub Pages or zeceipt.xyz)

## 5. Timeline

| Date | Milestone |
|---|---|
| 2026-09-24 | Push, forum post, pilot outreach |
| 2026-09-27 | zips #387 post |
| 2026-09-28 | Update video 1 |
| 2026-10-03 | Console + Solana status review; cut decisions |
| 2026-10-05 | Initial upload; update video 2 |
| 2026-10-09 | Final videos |
| 2026-10-10 | Freeze |
| 2026-10-11 | Final submission |
| 2026-10-12 | Deadline (buffer) |
