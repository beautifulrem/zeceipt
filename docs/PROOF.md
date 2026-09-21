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

## 2. synthetic — issue → verify → tamper (2026-09-22, verbatim transcript)

Fixture: `fixtures/synthetic-ironwood.hex`, produced by `cargo run -p zeceipt-core --features synthetic --example make_synthetic`, which replaces Ironwood action 0 of the mainnet transaction above with an output of 2.5 ZEC and memo `INV-2026-0142` encrypted to a fresh key (so the txid below differs from the template's). The issuer OVK is `fixtures/synthetic-ovk.hex`; the resulting signed, challenge-bound receipt is committed as `fixtures/synthetic-receipt.json`. Everything below is unedited stdout/stderr of `target/debug/zeceipt` (the `receipts/` and `issuer.key` paths were `/tmp/...` when captured).

```
$ zeceipt keygen --out issuer.key
{"issuer_pubkey":"605d49591b716d9a9122fb99a827536c774a1f7d1aa3dd6d560416bd4f75b517","key_file":"/tmp/issuer.key"}

$ zeceipt issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk $(cat fixtures/synthetic-ovk.hex) --label "INV-2026-0142 | 3,797.00 USD @ 1518.81 | 2026-09-22" --challenge auditor-nonce-7 --key-file issuer.key --key-id 2026-09 --out-dir receipts
{
  "height": null,
  "receipts": [
    {
      "receipt": {
        "challenge": "YXVkaXRvci1ub25jZS03",
        "issuer_key_id": "2026-09",
        "issuer_pubkey": "605d49591b716d9a9122fb99a827536c774a1f7d1aa3dd6d560416bd4f75b517",
        "label": "INV-2026-0142 | 3,797.00 USD @ 1518.81 | 2026-09-22",
        "network": "main",
        "ock": "5no0Myq8ZSeC3kCG897G4Hys8ArmczAFID7sX3-n3QU",
        "output_index": 0,
        "pool": "ironwood",
        "signature": "1ba8c66b1598a28595b92862783f24452d6cbfcc27145de7603bd2a750393cc2afef73c0ee30aca9dd183bbb01255144b56e4aabe6988897ee5468b98ed66e0a",
        "txid": "4f3cc1aea0e589bd77865d33a2476963ff94909a3f1bdc8cb9bb380360e91b7f",
        "version": "zeceipt-v0",
        "zip311_profile": "outputs-only"
      },
      "recovered": {
        "index": 0,
        "memo": {
          "kind": "text",
          "text": "INV-2026-0142"
        },
        "pool": "ironwood",
        "recipient": "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel",
        "value_zat": 250000000,
        "value_zec": "2.50000000"
      },
      "url": "https://zeceipt.xyz/r/eyJ2ZXJzaW9uIjoiemVjZWlwdC12MCIsIm5ldHdvcmsiOiJtYWluIiwicG9vbCI6Imlyb253b29kIiwidHhpZCI6IjRmM2NjMWFlYTBlNTg5YmQ3Nzg2NWQzM2EyNDc2OTYzZmY5NDkwOWEzZjFiZGM4Y2I5YmIzODAzNjBlOTFiN2YiLCJvdXRwdXRfaW5kZXgiOjAsIm9jayI6IjVubzBNeXE4WlNlQzNrQ0c4OTdHNEh5czhBcm1jekFGSUQ3c1gzLW4zUVUiLCJsYWJlbCI6IklOVi0yMDI2LTAxNDIgfCAzLDc5Ny4wMCBVU0QgQCAxNTE4LjgxIHwgMjAyNi0wOS0yMiIsImNoYWxsZW5nZSI6IllYVmthWFJ2Y2kxdWIyNWpaUzAzIiwiaXNzdWVyX2tleV9pZCI6IjIwMjYtMDkiLCJpc3N1ZXJfcHVia2V5IjoiNjA1ZDQ5NTkxYjcxNmQ5YTkxMjJmYjk5YTgyNzUzNmM3NzRhMWY3ZDFhYTNkZDZkNTYwNDE2YmQ0Zjc1YjUxNyIsInNpZ25hdHVyZSI6IjFiYThjNjZiMTU5OGEyODU5NWI5Mjg2Mjc4M2YyNDQ1MmQ2Y2JmY2MyNzE0NWRlNzYwM2JkMmE3NTAzOTNjYzJhZmVmNzNjMGVlMzBhY2E5ZGQxODNiYmIwMTI1NTE0NGI1NmU0YWFiZTY5ODg4OTdlZTU0NjhiOThlZDY2ZTBhIiwiemlwMzExX3Byb2ZpbGUiOiJvdXRwdXRzLW9ubHkifQ"
    }
  ]
}

$ zeceipt verify receipts/4f3cc1aea0e589bd-ironwood-0.json --raw-tx-file fixtures/synthetic-ironwood.hex --challenge auditor-nonce-7 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": null,
  "issuer_pubkey": "605d49591b716d9a9122fb99a827536c774a1f7d1aa3dd6d560416bd4f75b517",
  "label": "INV-2026-0142 | 3,797.00 USD @ 1518.81 | 2026-09-22",
  "memo": {
    "kind": "text",
    "text": "INV-2026-0142"
  },
  "output_index": 0,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel",
  "txid": "4f3cc1aea0e589bd77865d33a2476963ff94909a3f1bdc8cb9bb380360e91b7f",
  "valid": true,
  "value_zat": 250000000,
  "value_zec": "2.50000000"
}
exit=0

$ zeceipt verify ... --challenge nope --require-signature
{"error":"challenge mismatch","stage":"challenge","valid":false}
exit=1

$ zeceipt verify tampered.json (one bit of ock flipped) ... --require-signature
{"error":"signature is invalid","stage":"signature","valid":false}
exit=1

$ zeceipt verify tampered-unsigned.json (same, signature stripped) ...
{"error":"recovery failed: the ock does not open ironwood output 0","stage":"recovery","valid":false}
exit=1

$ zeceipt verify network-flipped.json (network changed to test after signing) ... --require-signature
{"error":"signature is invalid","stage":"signature","valid":false}
exit=1

$ zeceipt verify   (usage error)
error: the following required arguments were not provided:
  <RECEIPT>

Usage: zeceipt verify <RECEIPT>

For more information, try '--help'.
exit=3
```

The same matrix runs in CI (`.github/workflows/ci.yml`, including `pack` → `verify-pack --raw-tx-dir` and the usage-error exit code) and as `cargo test -p zeceipt-core --features synthetic` (`tests/offline_e2e.rs`), which additionally checks that the receipt is rejected against the original, unmodified transaction (`txid` stage), against a foreign output index (`recovery` stage), and that an audit pack recomputes the 2.5 ZEC total.

## 2b. synthetic + mainnet-read — browser verifier (WASM) in Chrome (2026-09-22)

`packages/verify/pkg` (committed) built with `wasm-pack build crates/zeceipt-wasm --target web --release` (809 KB `.wasm`; see README for the wasm32 clang note). Served `packages/verify/` locally and drove `demo/index.html` in Chrome:

| input | result shown by the page |
|---|---|
| `fixtures/synthetic-receipt.json` + `fixtures/synthetic-ironwood.hex` + challenge `auditor-nonce-7` + require signature | **VALID** — txid `4f3cc1ae…1b7f`, ironwood / 0, recipient `u1792v3n…`, 2.50000000 ZEC, memo `INV-2026-0142`, issuer `605d4959…` (key id 2026-09), challenge bound and matched |
| same receipt with `network` changed to `test` after signing | **INVALID** — failed at `signature`: signature is invalid (network is inside the signed bytes) |
| unsigned copy with label `x <b>bold</b> y` | VALID (unsigned accepted when not required); the label renders as literal text — no element is injected (escaping check) |
| "Fetch raw tx from public gRPC-web node" with a probe receipt for mainnet txid `0e85513c…da69` | status: `fetched from https://zjs.zec.rocks/mainnet (mined at height 3491284)`; 18,332 hex chars, prefix `06000080` (v6); verification then fails at `recovery` as expected for a random ock |

All verification ran inside the page (`zeceipt-wasm 0.1.0 (zeceipt-v0) ready`). The gRPC-web call is a hand-encoded `GetTransaction` (`packages/verify/src/index.js`, `fetchRawTx`), no proxy.

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
