# Proof log

Every claim in the README is backed by an entry here. Entries are labelled by evidence class:

- **mainnet-read**: real mainnet data fetched and parsed; no keys involved.
- **synthetic**: a real mainnet v6 transaction with one Ironwood action re-encrypted to a key we control. Cryptographically complete for the receipt (the note, memo and OCK are genuine), but the transaction is **not consensus-valid** and is not on chain. Used for issue → verify → tamper end-to-end without funds.
- **testnet** / **mainnet-write**: a transaction we sent. Not yet recorded — blocked on a faucet claim (see §4).

## 1. mainnet-read — v6 parsing and Ironwood enumeration (2026-09-22)

```
$ zeceipt inspect --txid 0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69
{ "height": 3491284, "version": "V6", "outputs": [ {"index":0,"pool":"ironwood"}, {"index":1,"pool":"ironwood"} ], … }
```
Fetched over gRPC from `https://zec.rocks:443` (`GetTransaction`). The same transaction is committed as `fixtures/0e85513c…69.hex` (source: Blockchair raw tx, block 3491284) and parsed in `cargo test` (`parses_mainnet_v6_fixture_and_enumerates_ironwood_actions`).

```
$ zeceipt find-ironwood --blocks 3
{ "endpoint": "https://zec.rocks:443", "tip": 3491306, "scanned": [3491303, 3491306], "transactions": [ {"height":3491304,"txid":"996ae3bc…"}, … ] }
```
`GetBlockRange` streaming, filtering `CompactTx.ironwoodActions`.

## 2. synthetic — issue → verify → tamper (2026-09-22)

Fixture: `fixtures/synthetic-ironwood.hex` (txid `be48df3476530cd1b6a9fa07f14140792f3b82ef0f335e58e18f5188e46e50dd`), produced by `cargo run -p zeceipt-core --features synthetic --example make_synthetic`, which replaces Ironwood action 0 of the mainnet transaction above with an output of 2.5 ZEC and memo `INV-2026-0142` encrypted to a fresh key. The issuer OVK is `fixtures/synthetic-ovk.hex`.

```
$ zeceipt keygen --out issuer.key
{"issuer_pubkey":"fa868fab8444a5d724bceb0ce2e4a7657fb7edc70d073e7368d2250cbe0cfd02", …}

$ zeceipt issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk $(cat fixtures/synthetic-ovk.hex) \
    --label "INV-2026-0142 | 3,797.00 USD @ 1518.81 | 2026-09-22" --challenge auditor-nonce-7 \
    --key-file issuer.key --key-id 2026-09 --out-dir receipts
→ 1 receipt: pool ironwood, index 0, recovered 2.50000000 ZEC to u1x3yke9a9el80um4t8ddchnyg0gtks73p3w9xhzhhy8t5gahv6yfc3r9u5y008nr9gy7kvwu4s9whzv3w5xsjel9lgst4u0kldycgwd3q, memo "INV-2026-0142"
   URL: https://zeceipt.xyz/r/eyJ2ZXJzaW9uIjoiemVjZWlwdC12MCIs…

$ zeceipt verify receipts/be48df3476530cd1-ironwood-0.json --raw-tx-file fixtures/synthetic-ironwood.hex --challenge auditor-nonce-7 --require-signature
{"valid": true, "recipient": "u1x3yke9…", "value_zec": "2.50000000", "memo": {"kind":"text","text":"INV-2026-0142"}, "issuer_pubkey": "fa868f…", "challenge_checked": true, …}   exit 0

$ zeceipt verify … --challenge nope --require-signature
{"valid":false,"stage":"challenge","error":"challenge mismatch"}                       exit 1

$ (flip one bit of ock) zeceipt verify tampered.json … --require-signature
{"valid":false,"stage":"signature","error":"signature is invalid"}                     exit 1

$ (same tamper, signature stripped) zeceipt verify tampered-unsigned.json …
{"valid":false,"stage":"recovery","error":"recovery failed: the ock does not open ironwood output 0"}   exit 1

$ echo "<URL>" | zeceipt verify - --raw-tx-file fixtures/synthetic-ironwood.hex --challenge auditor-nonce-7
{"valid": true, …}                                                                     exit 0
```

The same matrix runs in CI (`.github/workflows/ci.yml`) and as `cargo test -p zeceipt-core --features synthetic` (`tests/offline_e2e.rs`), which additionally checks that the receipt is rejected against the original, unmodified transaction (`txid` stage) and against a foreign output index (`recovery` stage).

## 2b. synthetic — browser verifier (WASM) in Chrome (2026-09-22)

`packages/verify/pkg` built with `wasm-pack build crates/zeceipt-wasm --target web --release` (809 KB `.wasm`; the transitive `secp256k1` C dependency is compiled with Homebrew LLVM clang for `wasm32-unknown-unknown`, see README). Served `packages/verify/` locally and drove `demo/index.html` in Chrome with the fixture receipt (`fixtures/synthetic-receipt.json`) and raw transaction:

| input | result shown by the page |
|---|---|
| receipt + raw tx + challenge `auditor-nonce-7` + require signature | **VALID** — txid `be48df34…50dd`, ironwood / 0, recipient `u1x3yke9…`, 2.50000000 ZEC, memo `INV-2026-0142`, issuer `fa868f…` (key id 2026-09), challenge bound and matched |
| challenge `wrong` | **INVALID** — failed at `challenge`: challenge mismatch |
| last base64url char of `ock` changed, signed | **INVALID** — failed at `signature`: signature is invalid |
| same tamper, signature stripped, signature not required | **INVALID** — failed at `recovery`: the ock does not open ironwood output 0 |

All verification ran inside the page (`zeceipt-wasm 0.1.0 (zeceipt-v0) ready`); the page made no network requests other than loading the two local fixture files.

## 3. unit — protocol-level round trip

`ironwood_round_trip_ock_derivation_and_recovery`: encrypt a V3 (Ironwood) note with a random FVK using the `orchard` crate's `IronwoodNoteEncryption`, derive the OCK with `Domain::derive_ock`, recover with `try_output_recovery_with_ock`, and check that a flipped OCK bit and another key's OCK both fail.

## 4. testnet — prepared, blocked on a human faucet claim

A testnet light wallet was created with `zcash-devtool` (built from source at `raw/tools/zcash-devtool`, wallet dir `raw/tools/testnet-wallet`, mnemonic encrypted to a local age identity; nothing from it is in this repository):

- Account `c1637de7-cd41-4567-9a61-7383aea12f90`, birthday height 4375968
- Receiving address (testnet UA): `utest1jlj43jsyqkek9nwnt80p50dl4tr4helrvlvh7fwykpalnn0y7xz2z4f9xhemvgrn5rnacu8h7r70tneqf78d20yzlm2rf7580fu6shql0s7520p99gu9sdq4y5rcqd4kf6rwjwu698pm4vq6g7k5mxyqcy8p6uq7xa8de3446al7chh5x5hpf0tare89x2898kvlzxfzef49vwyzhjt`
- UFVK: `uviewtest1llrzcdcc6v26y5rppkmff3mcu2sd0lyfkalt82qlsr5fxwc9842t8v3lyz02lnhtkuufze5x8t33gj3e9j6dlv4xk86vjp3c4ar9dxd2mj2vp2zp0g0ua2cwhzhju8eaqxcdvh963dun3d7uujpvg97w509nhm8ywlaudyf0637arudw5625usjq4gnw9rf7a29e7624m4dldsyj2tp2zjp6fnwfz7nt03syt8ns24k57lz7qsd8slv3vd8t2dwcqnxxewyccea50zmdqkm7jjc48uf3k4szg4uftlwtgvf3zu8tfgxmpzg99akzk3mtah77775vqkhv0z8vr3axphkflex8gvrlagjllx9xayp7yyyv5ajgyt3qfvkrx8qahz3urepkd4dk6eaau5mtq75m4t445808n47fmnuwcgf4ra64j66c325ax89z366um62k7jw6wtefux084ndd64rzdgm7e3mxuhchcmurl37nrxz9e55g24wh`

Remaining human step: paste the address into `https://zcashfaucet.jinolabs.xyz` (browser proof-of-work gate) or `https://fauzec.com` (Turnstile) to receive ~0.1 TAZ. Then:

```bash
D=raw/tools/zcash-devtool/target/release/zcash-devtool; W=raw/tools/testnet-wallet
$D wallet -w $W sync
$D wallet -w $W send --address <second utest address> --value 1000000 --memo "INV-T-001"   # 0.01 TAZ
zeceipt issue --testnet --ufvk uviewtest1… --txid <txid> --label "INV-T-001" --key-file issuer.key --out-dir receipts
zeceipt verify --testnet receipts/<file>.json --require-signature
```
Record txid, receipt URL and outputs here as a **testnet** entry.
