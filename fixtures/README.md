# Fixtures

| file | what | source |
|---|---|---|
| `0e85513c…da69.hex` | mainnet v6 transaction, 2 Ironwood actions, block 3491284 | Blockchair raw tx API, 2026-09-21; also fetched live via lightwalletd `GetTransaction` (see docs/PROOF.md §1) |
| `391fa065…7931.hex`, `97ea837b…84ef.hex` | additional mainnet v6 transactions from the same block (spare fixtures; `97ea…` is the coinbase) | Blockchair, 2026-09-21 |
| `synthetic-ironwood.hex` | `0e85513c…` with Ironwood action 0 replaced by an output encrypted to a throwaway key (2.5 ZEC, memo `INV-2026-0142`); **not consensus-valid** | `cargo run -p zeceipt-core --features synthetic --example make_synthetic` |
| `synthetic-ovk.hex` | external outgoing viewing key that opens that output | same |
| `synthetic-receipt.json` | signed, challenge-bound receipt for that output (challenge `auditor-nonce-7`) | `zeceipt issue`, see docs/PROOF.md §2 |
| `regtest-48be62e2…a92d.hex` | **consensus-valid** v6 Ironwood transaction mined on a local Zebra regtest chain (height 324): 2.5 REG + memo from account 0 to account 1 of a zcash-devtool wallet | `getrawtransaction` from zebrad RPC, 2026-09-22 (see docs/PROOF.md §5) |
| `regtest-48db254a…47b2.hex` | **consensus-valid** v6 Ironwood transaction built by **Zkool GraphQL `pay`** on the same regtest chain (height 626): 3 recipients (1.01/1.02/1.03 REG, memos `INV-R-002/003/004`) + change in 4 Ironwood actions; 15,478 bytes (largest fixture) | `getrawtransaction` from zebrad RPC, 2026-09-22 (see docs/PROOF.md §5b) |
| `regtest-issuer-ufvk.txt` | the regtest issuer's unified full viewing key (throwaway wallet; opens both regtest transactions above); used by the core test `zkool_batch_fixture_excludes_change_by_own_address` | zcash-devtool `list-accounts`, 2026-09-22 |
| `regtest-receipt.json` | receipt issued from the sender's UFVK for that transaction (output 1), signed, challenge `auditor-nonce-9` | `zeceipt issue --regtest --ufvk …` |
