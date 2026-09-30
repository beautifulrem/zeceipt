# Testnet receipts under a domain key id (2026-09-30)

The three receipts of `fixtures/testnet/` (INV-T-001..003), re-issued offline from the same transactions with the same
issuer key under key id `testnet-2026-09@beautifulremi.dpdns.org`, and `zeceipt.json`, the well-known file for that key
(`zeceipt well-known`). That file is served at `https://beautifulremi.dpdns.org/.well-known/zeceipt.json`, so
`zeceipt verify --testnet --check-issuer <file>` and the receipt page's "Check with beautifulremi.dpdns.org" report the
binding `confirmed` (`docs/PROOF.md` §6; spec §7). Offline: `--issuer-file fixtures/testnet-bound/zeceipt.json`.
