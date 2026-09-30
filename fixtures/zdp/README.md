# zcash-delivery-proof test vectors

`mainnet.json`, `testnet.json` and `constructed.json` are the test vectors of
[saplingcash/zcash-delivery-proof](https://github.com/saplingcash/zcash-delivery-proof) (`test-vectors/`), copied
unchanged at commit `d68ba2d3a23231b37ba512c00562c590ea01a5e4` (2026-09-28). They are Copyright 2026 Sapling
(sapling.cash) under the Apache License 2.0; their `NOTICE` is kept here as the licence requires.

Zeceipt checks `zdp:1:` delivery proofs (`zeceipt_core::delivery`), and `crates/zeceipt-core/tests/delivery.rs`
checks every proof in these files, plus tampered copies that must fail. `mainnet.json` is a real mainnet transaction
(height 3,499,556); `testnet.json` a real testnet one (height 4,398,896); `constructed.json` holds payments built by
librustzcash and never broadcast.
