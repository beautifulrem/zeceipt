# Testnet receipts (2026-09-30)

Zeceipt's own receipts on a public chain (`docs/PROOF.md` §6):
- three signed receipts, one per payment, for INV-T-001..003 (0.01, 0.02 and 0.03 TAZ) on Zcash testnet, mined at heights 4,420,000, 4,420,003 and 4,420,005;
- the raw transactions (`<txid>.hex`, as `zjs.zec.rocks/testnet` served them);
- the audit pack (`pack.json`).

`zeceipt verify-pack fixtures/testnet/pack.json --testnet --require-signature --raw-tx-dir fixtures/testnet` checks them offline (a CLI test does, in CI); without `--raw-tx-dir` it fetches the transactions from a testnet node. The issuer key is `cd34f5535c1398580429f82b4d2344e553132148c8e67376b5678901f84a3f6e` (key id `testnet-2026-09`); its secret is not in this repository.
