# Fixtures

| file | what | source |
|---|---|---|
| `0e85513c…da69.hex` | mainnet v6 transaction, 2 Ironwood actions, block 3491284 | Blockchair raw tx API, 2026-09-21; also fetched live via lightwalletd `GetTransaction` (see docs/PROOF.md §1) |
| `391fa065…7931.hex`, `97ea837b…84ef.hex` | additional mainnet v6 transactions from the same block (spare fixtures; `97ea…` is the coinbase) | Blockchair, 2026-09-21 |
| `synthetic-ironwood.hex` | `0e85513c…` with Ironwood action 0 replaced by an output encrypted to a throwaway key (2.5 ZEC, memo `INV-2026-0142`); **not consensus-valid** | `cargo run -p zeceipt-core --features synthetic --example make_synthetic` |
| `synthetic-ovk.hex` | external outgoing viewing key that opens that output | same |
| `synthetic-receipt.json` | signed, challenge-bound receipt for that output (challenge `auditor-nonce-7`) | `zeceipt issue`, see docs/PROOF.md §2 |
