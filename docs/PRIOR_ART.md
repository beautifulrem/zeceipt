# Prior art and what Zeceipt adds

Colosseum rules require disclosure of pre-existing work. Nothing below is copied into this repository; where an idea is reused it is credited here and in code comments.

| Work | What it is | Relationship to Zeceipt |
|---|---|---|
| [ZIP 311 — Zcash Payment Disclosures](https://zips.z.cash/zip-0311) (draft, J. Grigg) and [zcash/zips#387](https://github.com/zcash/zips/issues/387) | Specifies per-output disclosure via the Outgoing Cipher Key, plus a spend-authority signature. Orchard support is marked TODO; no implementation exists. | Zeceipt implements the **outputs half** for Ironwood, Orchard and Sapling with a versioned envelope. It does **not** implement the spend-authority proof (requires spending keys). We will feed encoding feedback to #387. |
| ZIP 303 (withdrawn), ZIP 304, ZIP 310 | Sprout payment disclosure; Sapling address signatures; security properties of viewing keys. | Background for the threat model. |
| zcashd `z_getpaymentdisclosure` / `z_validatepaymentdisclosure` (experimental, Sprout-only, deprecated) | First product shape: blob + validator returning signature/commitment/validity checks. | Our verifier reports the same three-part outcome (cryptographic validity, chain inclusion, issuer binding). |
| [ZCG grant #437 — Selected-Payment Receipts SDK](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/437) (CopperSeventhLLC, filed 2026-09-21, open) | Proposal for a similar SDK on testnet, delivery Dec 2026–Feb 2027. | Independent, later, not funded. We align field names where sensible. |
| [Glasspane](https://github.com/dolepee/glasspane) (dolepee, ZecHub Hackathon 3.0, Orchard, last commit 2026-07-13) | Per-output OCK receipts and "rooms" on the now-sealed Orchard pool; Rust workspace + WASM verifier. | Same cryptographic primitive (it is the protocol's). Zeceipt is a fresh implementation targeting the Ironwood pool (v6 transactions), adds challenge binding, key ids, audit packs with lower-bound semantics, a lightwalletd block-scan mode, and an issuer/verifier CLI. Spec lineage credited. |
| [Konclave](https://github.com/deegalabs/konclave) (DeegaLabs, FROST vault + private payroll, active) | Threshold-signed treasury with one-tx-N-memo payroll and an internal ledger. | Integration target: a Konclave export can attach an ock column and emit Zeceipt receipts. Not a competitor. |
| [ZBooks](https://github.com/AustinChris1/ZBooks-SIWZ), [zecpay](https://github.com/Spider333/zecpay), Zwage (zwage.xyz, offline), [Rime](https://github.com/Giri-Aayush/rime), ZBounty | Payout/approval/accounting tools from ZecHub Hackathon 3.0 and earlier. | Vehicles that could issue receipts; none provides per-payment verifiable disclosure. |
| [ZecLedger](https://github.com/vancube2/zecledger), zechledger (agyion-foundation) | UFVK read-only accounting; application-layer signed audit capsules. | Complementary; capsules attest metadata, receipts prove chain contents. |
| [Zenvelope](https://github.com/IhorMuliar/zenvelope) (CWF 2026 Zcash track) | ZIP-324 link payments with in-browser Ironwood proving. | Same hackathon; different product. Demonstrated that the Rust crates compile to WASM for Ironwood. |
| veil402 (Solana) | Per-transaction, per-verifier selective disclosure on a Solana shielded pool. | Parallel concept on another chain. |
| Monero `get_tx_key` / `check_tx_key` | Shipped per-transaction proof of payment in a privacy coin. | UX reference (Prove/Check in the wallet). |
| [OpenZcash](https://openzcash.org) | Public mirror of the ZCG disbursement ledger. | Consumer: rows can link to receipts. |

Status rechecked on 2026-09-28 through the GitHub API (`docs/product/10_research_log.md` R121, R124):
- ZIP 311 is still a draft, and its text is unchanged in substance since 2024. zips #387 has had no activity since 2026-03-24.
- ZCG #437 is unchanged since 2026-09-22 (open, "Ready For ZCG Review").
- Glasspane has had no commit since 2026-07-13.
- Konclave's last release is v0.6.0 (2026-09-22), with no commit since 2026-09-22. Its "receipts" are signing-ceremony records (approvers, date, txid, with the signature behind a disclosure; pull request #181, merged 2026-08-21), not chain-verifiable per-output payment receipts.
- No maintained wallet we searched implements ZIP 311 or a payment-disclosure RPC:
  - Zallet's issues, pull requests and code; Zallet explicitly does not migrate zcashd's `paymentdisclosure` option;
  - the zcash, zingolabs, zodl-inc, Electric-Coin-Company and ZcashFoundation organisations;
  - Zkool.

  zcashd's experimental, Sprout-only RPCs (table above) are deprecated. The nearest items are a 2018 feature request, "Selective disclosure" (ZcashFoundation/zecwallet #47, open, never implemented), and an unmerged memo-attestation display (zodl-android #2173, `ZAP1` memos, closed 2026-07-29), which is not payment disclosure.

Libraries used unmodified: `orchard`, `sapling-crypto`, `zcash_note_encryption`, `zcash_primitives`, `zcash_keys`, `zcash_address`, `zcash_client_backend` (proto client), `tonic`, `ed25519-dalek`.
