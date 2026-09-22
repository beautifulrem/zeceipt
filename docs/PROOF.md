# Proof log

Every claim in the README is backed by an entry here. Entries are labelled by evidence class:

- **mainnet-read**: real mainnet data fetched and parsed; no keys involved.
- **synthetic**: a real mainnet v6 transaction with one Ironwood action re-encrypted to a key we control. Cryptographically complete for the receipt (the note, memo and OCK are genuine), but the transaction is **not consensus-valid** and is not on chain. Used for issue → verify → tamper end-to-end without funds.
- **regtest**: a consensus-valid transaction built by a real wallet and mined by a real Zebra node on a private regtest chain, indexed by Zaino, issued through the UFVK path and read back over gRPC (§5). Everything a public-chain proof shows except "exists on a public chain".
- **testnet** / **mainnet-write**: a transaction we sent on a public chain. Not yet recorded — blocked on a faucet claim (see §4, §6).

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

`packages/verify/pkg` (committed) built with `wasm-pack build crates/zeceipt-wasm --target web --release` (696 KB `.wasm` = 712,803 bytes at HEAD, rebuilt 2026-09-22 after the change-detection fix; see README for the wasm32 clang note). Served `packages/verify/` locally and drove `demo/index.html` in Chrome:

| input | result shown by the page |
|---|---|
| `fixtures/synthetic-receipt.json` + `fixtures/synthetic-ironwood.hex` + challenge `auditor-nonce-7` + require signature | **VALID** — txid `4f3cc1ae…1b7f`, ironwood / 0, recipient `u1792v3n…`, 2.50000000 ZEC, memo `INV-2026-0142`, issuer `605d4959…` (key id 2026-09), challenge bound and matched |
| same receipt with `network` changed to `test` after signing | **INVALID** — failed at `signature`: signature is invalid (network is inside the signed bytes) |
| unsigned copy with label `x <b>bold</b> y` | VALID (unsigned accepted when not required); the label renders as literal text — no element is injected (escaping check) |
| "Fetch raw tx from public gRPC-web node" with a probe receipt for mainnet txid `0e85513c…da69` | status: `fetched from https://zjs.zec.rocks/mainnet (mined at height 3491284)`; 18,332 hex chars, prefix `06000080` (v6); verification then fails at `recovery` as expected for a random ock |

All verification ran inside the page (`zeceipt-wasm 0.1.0 (zeceipt-v0) ready`). The gRPC-web call is a hand-encoded `GetTransaction` (`packages/verify/src/index.js`, `fetchRawTx`), no proxy.

Timing (2026-09-22, NFR-4). Chrome 153 on `demo/index.html` served locally, `performance.now()` around `verifyReceipt` from `src/index.js`, 20-run averages, signed and challenge-bound receipts: **7.28 ms** on the synthetic fixture (9,166-byte tx) and **6.05 ms** on the Zkool batch fixture `regtest-48db254a…` (15,478 bytes, 4 Ironwood actions, receipt for output 1). 69 % more bytes cost no more time: verification decrypts exactly one output, so the cost is dominated by that single trial decryption and is roughly flat in transaction size across 9–15 KB. At 6–7 ms the measurement is **more than 130× inside the 1 s budget**; the remaining 23 % to the NFR's 20 KB bound is not measured but cannot plausibly change that order of magnitude. Node 26 on the committed wasm: init 13.9 ms; `verify_receipt` 4.11 ms (regtest fixture) / 3.19 ms (synthetic). CLI (release build, `/usr/bin/time`): `zeceipt inspect --txid 0e85513c…da69` fetching the mainnet tx from `zec.rocks` over gRPC/TLS 1.15 s wall; `zeceipt issue --regtest --raw-tx-file … --ufvk …` (trial-decrypt of both outputs + signing, offline) 0.00 s wall; `zeceipt verify --regtest --raw-tx-file …` offline 0.01 s. So a public-node `issue` is fetch-bound at ≈ 1–2 s. The page shows the mined height for fetched transactions and tells the user to confirm depth on an explorer or their own node; it does not compute confirmations itself.

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

## 5. regtest — consensus-valid Ironwood transaction, UFVK issuance, gRPC verification (2026-09-22, verbatim transcript)

Setup (all built from source under `raw/tools/`, outside this repo): `zebrad` v6.3.0 with `--features internal-miner`, Regtest with every upgrade including NU6.3 (Ironwood) at height 1; `zainod` (Zaino) indexing it with the fetch backend on `http://127.0.0.1:8137`; `zcash-devtool` built with `regtest_support`, wallet restored from a throwaway mnemonic. Coinbase was mined to the wallet's transparent address, matured, shielded into the Ironwood pool (`shield` txid `e97e6c39…088d`), and 2.5 REG was sent from account 0 to account 1 with a memo (`send` txid `48be62e2…a92d`, mined at height 324; account 1's balance showed `Ironwood Spendable: 2.50000000 REG` after sync). The raw transaction (`getrawtransaction` from zebrad) is committed as `fixtures/regtest-48be62e2…a92d.hex` and the receipt as `fixtures/regtest-receipt.json`; `crates/zeceipt-cli/tests/cli.rs::regtest_receipt_verifies_offline_and_tamper_fails` replays the offline part.

Observation: `--include-change` did **not** add the change output (index 0) — the last block of the transcript still lists only output 1 — i.e. the internal-scope OVK derived from the UFVK did not open it. The payment output (index 1) is opened by the external OVK as expected. Whether zcash-devtool encrypts Ironwood change to a different key is an open question, recorded in `.trellis` and the runbook; it does not affect recipient receipts. Every command line and output in the block below is unedited (paths were `/tmp/rt/...` when captured).

```
# regtest chain: zebrad v6.3.0 (Regtest, all upgrades incl. NU6.3 at height 1, internal miner) + zainod (fetch backend) at http://127.0.0.1:8137; wallet: zcash-devtool (regtest_support)
$ zeceipt inspect --regtest --endpoint http://127.0.0.1:8137 --txid 48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d
{
  "height": 324,
  "outputs": [
    {
      "index": 0,
      "pool": "ironwood"
    },
    {
      "index": 1,
      "pool": "ironwood"
    }
  ],
  "txid": "48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",
  "version": "V6"
}
exit=0

$ zeceipt keygen --out issuer.key
{"issuer_pubkey":"8073aabe5d4b37c86bd16b1951f5a55710a5480e4e469459d9745a1937d3d348","key_file":"/tmp/rt/issuer.key"}

$ zeceipt issue --regtest --endpoint http://127.0.0.1:8137 --ufvk $(cat issuer-ufvk.txt) --txid 48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d --label "INV-R-001 | 3,797.00 USD @ 1518.81 | 2026-09-22" --challenge auditor-nonce-9 --key-file issuer.key --key-id 2026-09 --out-dir receipts
{
  "height": 324,
  "receipts": [
    {
      "receipt": {
        "challenge": "YXVkaXRvci1ub25jZS05",
        "issuer_key_id": "2026-09",
        "issuer_pubkey": "8073aabe5d4b37c86bd16b1951f5a55710a5480e4e469459d9745a1937d3d348",
        "label": "INV-R-001 | 3,797.00 USD @ 1518.81 | 2026-09-22",
        "network": "regtest",
        "ock": "0zI9X1AzSQQo_3lXSFaPs-iRcQRxOKwl8yoptwyqisQ",
        "output_index": 1,
        "pool": "ironwood",
        "signature": "9c6249aa9f1c9e86bf983975bcb9473ee490c1068f05771cb000c70d1f541d574a13b1b110252e7c3907fd6d74f25ca5f29e5b9c820e20f00e30ad427c78ed0a",
        "txid": "48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",
        "version": "zeceipt-v0",
        "zip311_profile": "outputs-only"
      },
      "recovered": {
        "index": 1,
        "memo": {
          "kind": "text",
          "text": "INV-R-001 | 3,797.00 USD @ 1518.81"
        },
        "pool": "ironwood",
        "recipient": "uregtest13p4s2q35trtan2kkgul8yz8v2n575vjdny83g77fxa6da66v95p4c8jenww5te3a8cxssrlpn02p7rgxx3m8537t4a0ufcnl058fjv5t",
        "value_zat": 250000000,
        "value_zec": "2.50000000"
      },
      "url": "https://zeceipt.xyz/r/eyJ2ZXJzaW9uIjoiemVjZWlwdC12MCIsIm5ldHdvcmsiOiJyZWd0ZXN0IiwicG9vbCI6Imlyb253b29kIiwidHhpZCI6IjQ4YmU2MmUyMWJkYzk4MDgwZGE5YWEzOTY4NDRjOGJkN2Y4NjQ5NmNhMGNiMTc1OWVhOTFkMWExOWUwZmE5MmQiLCJvdXRwdXRfaW5kZXgiOjEsIm9jayI6IjB6STlYMUF6U1FRb18zbFhTRmFQcy1pUmNRUnhPS3dsOHlvcHR3eXFpc1EiLCJsYWJlbCI6IklOVi1SLTAwMSB8IDMsNzk3LjAwIFVTRCBAIDE1MTguODEgfCAyMDI2LTA5LTIyIiwiY2hhbGxlbmdlIjoiWVhWa2FYUnZjaTF1YjI1alpTMDUiLCJpc3N1ZXJfa2V5X2lkIjoiMjAyNi0wOSIsImlzc3Vlcl9wdWJrZXkiOiI4MDczYWFiZTVkNGIzN2M4NmJkMTZiMTk1MWY1YTU1NzEwYTU0ODBlNGU0Njk0NTlkOTc0NWExOTM3ZDNkMzQ4Iiwic2lnbmF0dXJlIjoiOWM2MjQ5YWE5ZjFjOWU4NmJmOTgzOTc1YmNiOTQ3M2VlNDkwYzEwNjhmMDU3NzFjYjAwMGM3MGQxZjU0MWQ1NzRhMTNiMWIxMTAyNTJlN2MzOTA3ZmQ2ZDc0ZjI1Y2E1ZjI5ZTViOWM4MjBlMjBmMDBlMzBhZDQyN2M3OGVkMGEiLCJ6aXAzMTFfcHJvZmlsZSI6Im91dHB1dHMtb25seSJ9"
    }
  ]
}
exit=0

$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 receipts/48be62e21bdc9808-ironwood-1.json --challenge auditor-nonce-9 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": 324,
  "issuer_pubkey": "8073aabe5d4b37c86bd16b1951f5a55710a5480e4e469459d9745a1937d3d348",
  "label": "INV-R-001 | 3,797.00 USD @ 1518.81 | 2026-09-22",
  "memo": {
    "kind": "text",
    "text": "INV-R-001 | 3,797.00 USD @ 1518.81"
  },
  "output_index": 1,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "uregtest13p4s2q35trtan2kkgul8yz8v2n575vjdny83g77fxa6da66v95p4c8jenww5te3a8cxssrlpn02p7rgxx3m8537t4a0ufcnl058fjv5t",
  "txid": "48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",
  "valid": true,
  "value_zat": 250000000,
  "value_zec": "2.50000000"
}
exit=0

$ curl -s --data-binary '{"jsonrpc":"2.0","id":1,"method":"getrawtransaction","params":["48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",0]}' -H 'content-type: application/json' http://127.0.0.1:18232 | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"])' > regtest-tx.hex
$ wc -c regtest-tx.hex
18333 regtest-tx.hex
$ zeceipt verify receipts/48be62e21bdc9808-ironwood-1.json --raw-tx-file regtest-tx.hex --challenge auditor-nonce-9 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": null,
  "issuer_pubkey": "8073aabe5d4b37c86bd16b1951f5a55710a5480e4e469459d9745a1937d3d348",
  "label": "INV-R-001 | 3,797.00 USD @ 1518.81 | 2026-09-22",
  "memo": {
    "kind": "text",
    "text": "INV-R-001 | 3,797.00 USD @ 1518.81"
  },
  "output_index": 1,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "uregtest13p4s2q35trtan2kkgul8yz8v2n575vjdny83g77fxa6da66v95p4c8jenww5te3a8cxssrlpn02p7rgxx3m8537t4a0ufcnl058fjv5t",
  "txid": "48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",
  "valid": true,
  "value_zat": 250000000,
  "value_zec": "2.50000000"
}
exit=0

$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 tampered.json (one ock bit flipped) --challenge auditor-nonce-9 --require-signature
{"error":"signature is invalid","stage":"signature","valid":false}
exit=1

$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 tampered-unsigned.json (same, signature stripped) --challenge auditor-nonce-9
{"error":"recovery failed: the ock does not open ironwood output 1","stage":"recovery","valid":false}
exit=1

$ zeceipt issue --regtest --endpoint http://127.0.0.1:8137 --ufvk $(cat issuer-ufvk.txt) --txid 48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d --label change-check --include-change
{
  "height": 324,
  "receipts": [
    {
      "receipt": {
        "label": "change-check",
        "network": "regtest",
        "ock": "0zI9X1AzSQQo_3lXSFaPs-iRcQRxOKwl8yoptwyqisQ",
        "output_index": 1,
        "pool": "ironwood",
        "txid": "48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d",
        "version": "zeceipt-v0",
        "zip311_profile": "outputs-only"
      },
      "recovered": {
        "index": 1,
        "memo": {
          "kind": "text",
          "text": "INV-R-001 | 3,797.00 USD @ 1518.81"
        },
        "pool": "ironwood",
        "recipient": "uregtest13p4s2q35trtan2kkgul8yz8v2n575vjdny83g77fxa6da66v95p4c8jenww5te3a8cxssrlpn02p7rgxx3m8537t4a0ufcnl058fjv5t",
        "value_zat": 250000000,
        "value_zec": "2.50000000"
      },
      "url": "https://zeceipt.xyz/r/eyJ2ZXJzaW9uIjoiemVjZWlwdC12MCIsIm5ldHdvcmsiOiJyZWd0ZXN0IiwicG9vbCI6Imlyb253b29kIiwidHhpZCI6IjQ4YmU2MmUyMWJkYzk4MDgwZGE5YWEzOTY4NDRjOGJkN2Y4NjQ5NmNhMGNiMTc1OWVhOTFkMWExOWUwZmE5MmQiLCJvdXRwdXRfaW5kZXgiOjEsIm9jayI6IjB6STlYMUF6U1FRb18zbFhTRmFQcy1pUmNRUnhPS3dsOHlvcHR3eXFpc1EiLCJsYWJlbCI6ImNoYW5nZS1jaGVjayIsInppcDMxMV9wcm9maWxlIjoib3V0cHV0cy1vbmx5In0"
    }
  ]
}
exit=0
```

Update 2026-09-22 (later): the change-output question is resolved in §5b — change is now recognised by address ownership rather than OVK scope; devtool's change key remains unopened (RSK-5).

## 5b. regtest — Zkool GraphQL execution backend: 3 recipients, 3 memos, one Ironwood transaction (2026-09-22)

Tracer bullet for the payout console's primary execution backend (REQ-CON-7; WBS 3.3.5.4 / 3.3.4.2; Trellis task `09-22-zkool-tracer`). Same regtest chain as §5 (zebrad 6.3.0 internal miner + Zaino at `http://127.0.0.1:8137`). Zkool GraphQL was built from source (`hhanh00/zkool2` at 8785e5c, `cargo build --release --bin zkool_graphql --no-default-features --features graphql`, toolchain 1.95.0; the clone's regtest network definition was patched so NU6.3 activates at height 1 like our chain instead of 250) and run as `zkool_graphql --coin 2 --lwd-url http://127.0.0.1:8137 --no-mempool --port 9000`. The capture scripts are in the repository (`scripts/regtest/issue-batch2.sh`, `verify-batch2.sh`, `recipient-notes.sh`, parameterised by `ZECEIPT_BIN`/`ARTIFACT_DIR`/`ENDPOINT`/`GRAPHQL`; procedure in `docs/REGTEST_RUNBOOK.md`); their outputs and the tracer transcripts live under `raw/tools/regtest/` (outside the repository, next to the throwaway mnemonic and the issuer signing key): `zkool-tracer.txt`, `zkool-tracer-run2.txt`, `zkool-recipient-notes.txt`, `issue-batch2.out`, `verify-batch2.out`. Re-running each script reproduces its recorded output byte-for-byte (checked 2026-09-22). Driver: `scripts/zkool_regtest_tracer.py` (the mnemonic is read from a file, posted only to a loopback host through a proxy-less opener, and never echoed).

Two runs are recorded. **Run 1** (transcript `zkool-tracer.txt`) used `--issuer-id 5`, an account restored by hand with `useInternal: true` after a first restore with `useInternal: false` (account 1) had shown a balance of 0 — zcash-devtool had shielded the coinbase and sent change at the internal scope, so Zkool must scan that scope. Run 1's recipient lines below end in `"outputs": []`: that first script version queried `outputs` (the sender-side view, empty for received shielded notes); the recipient's shielded view is `notes { value pool memo }`, captured separately in `zkool-recipient-notes.txt` and quoted in full further down. **Run 2** (`zkool-tracer-run2.txt`) re-ran the committed script end to end — restore path with `useInternal: true`, new recipients, `notes` query, memo assertion — and exited 0.

### Run 1 transcript (`raw/tools/regtest/zkool-tracer.txt`; `[tracer]` lines in full, then the script's final JSON; the `$ gql …` echoes are omitted)

```
[tracer] node height at start: 620
[tracer] issuer UA: uregtest1xjznnqvkfwhw7nzjwvk4cjsv26v02y8tljxx70qv7t5rnm0tkw36w9zncxrmwex2zl6j7a0huaxjt6cn7u6vytw6q7t9mt05grn0p7lzynk9tk37appgmy4rpddlrjw0yjlncj74uy63t7dutl97lku8038ze26ducr975k4vcp6wzvn
[tracer] issuer sync took 0.1s
[tracer] issuer balance: {'height': 620, 'transparent': '0', 'sapling': '0', 'orchard': '0', 'ironwood': '878.74265000', 'total': '878.74265000'}
[tracer] pay returned txid 48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2 in 8.5s
[tracer] mined at height 626 (19s after pay)
[tracer] recipient 6 (uregtest1qzj498rks3e…) balance 1.01000000 expected 1.01 memo 'INV-R-002': [{"txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2", "height": 626, "outputs": []}]
[tracer] recipient 7 (uregtest1km3xxn9hysa…) balance 1.02000000 expected 1.02 memo 'INV-R-003': [{"txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2", "height": 626, "outputs": []}]
[tracer] recipient 8 (uregtest17mjv2tq2m6x…) balance 1.03000000 expected 1.03 memo 'INV-R-004': [{"txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2", "height": 626, "outputs": []}]
{
  "txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2",
  "mined_height": 626,
  "issuer": 5,
  "recipients": [
    {
      "id": 6,
      "address": "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
      "amount": "1.01",
      "memo": "INV-R-002"
    },
    {
      "id": 7,
      "address": "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
      "amount": "1.02",
      "memo": "INV-R-003"
    },
    {
      "id": 8,
      "address": "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
      "amount": "1.03",
      "memo": "INV-R-004"
    }
  ],
  "elapsed_s": 18.9
}
```

Three fresh Zkool accounts (ids 6–8, Ironwood only) received 1.01 / 1.02 / 1.03 REG with memos `INV-R-002` / `INV-R-003` / `INV-R-004` in **one** v6 transaction `48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2`, mined at height 626, 19 s after `pay` returned (8.5 s to build and prove). Block 626 contains exactly one non-coinbase transaction (checked with `getblock`).

### Recipient views and memo-limit probe (`scripts/regtest/recipient-notes.sh` → `raw/tools/regtest/zkool-recipient-notes.txt`, verbatim)

```
$ curl --noproxy '*' -s -X POST http://127.0.0.1:9000/graphql -H 'Content-Type: application/json' -d '{"query":"{ transactionsByAccount(idAccount: 6, height: 0) { txid height value notes { value pool memo } } }"}'
{"data":{"transactionsByAccount":[{"txid":"1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb","height":648,"value":"0.00100000","notes":[{"value":"0.00100000","pool":3,"memo":"MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"}]},{"txid":"48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2","height":626,"value":"1.01000000","notes":[{"value":"1.01000000","pool":3,"memo":"INV-R-002"}]}]}}
$ curl --noproxy '*' -s -X POST http://127.0.0.1:9000/graphql -H 'Content-Type: application/json' -d '{"query":"{ transactionsByAccount(idAccount: 7, height: 0) { txid height value notes { value pool memo } } }"}'
{"data":{"transactionsByAccount":[{"txid":"48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2","height":626,"value":"1.02000000","notes":[{"value":"1.02000000","pool":3,"memo":"INV-R-003"}]}]}}
$ curl --noproxy '*' -s -X POST http://127.0.0.1:9000/graphql -H 'Content-Type: application/json' -d '{"query":"{ transactionsByAccount(idAccount: 8, height: 0) { txid height value notes { value pool memo } } }"}'
{"data":{"transactionsByAccount":[{"txid":"48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2","height":626,"value":"1.03000000","notes":[{"value":"1.03000000","pool":3,"memo":"INV-R-004"}]}]}}
$ # memo-limit probe, 512 bytes (already mined as 1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb, height 648): recipient 6's view with memo lengths
{"txid": "1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb", "height": 648, "value": "0.00100000", "memo_len": [512]}
{"txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2", "height": 626, "value": "1.01000000", "memo_len": [9]}
$ # memo-limit probe, 513 bytes: pay(idAccount: 5, recipients: [{address: <recipient 6 UA>, amount: "0.001", memo: "M"×513}], srcPools: 8)
{"data":null,"errors":[{"message":"Memo length 513 is larger than maximum of 512","locations":[{"line":1,"column":39}],"path":["pay"]}]}
```

The 512-byte memo was accepted (tx `1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb`, height 648, seen by recipient 6 with a 512-character memo); the 513-byte memo was rejected before signing with the error object captured above.

### Run 2 — reproduction with the committed script (`raw/tools/regtest/zkool-tracer-run2.txt`; `[tracer]` lines and the createAccount echo in full, then the script's final JSON; the `$ gql …` echoes are omitted)

```
[tracer] node height at start: 960
$ gql mutation createAccount(issuer from file, key redacted, useInternal=true) -> id 9
[tracer] issuer UA: uregtest1xjznnqvkfwhw7nzjwvk4cjsv26v02y8tljxx70qv7t5rnm0tkw36w9zncxrmwex2zl6j7a0huaxjt6cn7u6vytw6q7t9mt05grn0p7lzynk9tk37appgmy4rpddlrjw0yjlncj74uy63t7dutl97lku8038ze26ducr975k4vcp6wzvn
[tracer] issuer sync took 0.8s
[tracer] issuer balance: {'height': 960, 'transparent': '0', 'sapling': '0', 'orchard': '0', 'ironwood': '875.68135000', 'total': '875.68135000'}
[tracer] pay returned txid 541143995066e03bb95df2e40817a548651129abf294349e1f1e5cf9ace438e4 in 2.5s
[tracer] mined at height 963 (23s after pay)
[tracer] recipient 10 uregtest1z5ltu360ac2w9knkxq7ytu4wz9u0cs2rhs9tgkyvw746jnjwcnprpp6q95cysmnvyxa2v4vsrnk4vdwqe2ks4wc66763kvxhhc98ulq6 expected 0.51 'INV-R-005' -> OK: [{"txid": "541143995066e03bb95df2e40817a548651129abf294349e1f1e5cf9ace438e4", "height": 963, "value": "0.51000000", "notes": [{"value": "0.51000000", "pool": 3, "memo": "INV-R-005"}]}]
[tracer] recipient 11 uregtest1gp2szns9zyvchvrfz0jhdhugykhzj8nvn6wd7hrmr2j4q85r000ympzsz8svy7k0kn3a33fl7nnzm9d82vnz0r4sp4z7c83dput9pxcs expected 0.52 'INV-R-006' -> OK: [{"txid": "541143995066e03bb95df2e40817a548651129abf294349e1f1e5cf9ace438e4", "height": 963, "value": "0.52000000", "notes": [{"value": "0.52000000", "pool": 3, "memo": "INV-R-006"}]}]
[tracer] recipient 12 uregtest1rqwdd05yxqf4807jcddv556x6pq2xqnqtyt6hsv3gzg6wnayrqthv7fw0fuvplrzxsjq2fzpnzmltndrpzulpvs7k25wyn5cfvsu294d expected 0.53 'INV-R-007' -> OK: [{"txid": "541143995066e03bb95df2e40817a548651129abf294349e1f1e5cf9ace438e4", "height": 963, "value": "0.53000000", "notes": [{"value": "0.53000000", "pool": 3, "memo": "INV-R-007"}]}]
{
  "txid": "541143995066e03bb95df2e40817a548651129abf294349e1f1e5cf9ace438e4",
  "mined_height": 963,
  "issuer": 9,
  "use_internal": true,
  "recipients": [
    {
      "id": 10,
      "address": "uregtest1z5ltu360ac2w9knkxq7ytu4wz9u0cs2rhs9tgkyvw746jnjwcnprpp6q95cysmnvyxa2v4vsrnk4vdwqe2ks4wc66763kvxhhc98ulq6",
      "amount": "0.51",
      "memo": "INV-R-005"
    },
    {
      "id": 11,
      "address": "uregtest1gp2szns9zyvchvrfz0jhdhugykhzj8nvn6wd7hrmr2j4q85r000ympzsz8svy7k0kn3a33fl7nnzm9d82vnz0r4sp4z7c83dput9pxcs",
      "amount": "0.52",
      "memo": "INV-R-006"
    },
    {
      "id": 12,
      "address": "uregtest1rqwdd05yxqf4807jcddv556x6pq2xqnqtyt6hsv3gzg6wnayrqthv7fw0fuvplrzxsjq2fzpnzmltndrpzulpvs7k25wyn5cfvsu294d",
      "amount": "0.53",
      "memo": "INV-R-007"
    }
  ],
  "recipient_memo_failures": 0,
  "elapsed_s": 23.6
}
```

### Transaction shape (run 1)

```
$ zeceipt inspect --regtest --endpoint http://127.0.0.1:8137 --txid 48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2
{"height": 626, "version": "V6", "outputs": [{"index":0,"pool":"ironwood"},{"index":1,"pool":"ironwood"},{"index":2,"pool":"ironwood"},{"index":3,"pool":"ironwood"}]}
```

No padding: 3 recipients + change = exactly 4 Ironwood actions. The raw transaction (15,478 bytes, `getrawtransaction` from zebrad) is committed as `fixtures/regtest-48db254a…47b2.hex` (byte-identical to `raw/tools/regtest/tx-48db254a.hex`), the issuer's UFVK as `fixtures/regtest-issuer-ufvk.txt`.

### Finding: change is not identified by OVK scope

The first `zeceipt issue` run (external-scope UFVK, change excluded "by default") returned **four** receipts: output 0 was the 217.25048750 REG change, opened by the *external* OVK. Zkool encrypts change with the external OVK; zcash-devtool (§5) encrypts change with a key the UFVK does not expose (still unopened by either scope). So scope is not a change signal. Fixed the same day in `zeceipt-core`: both scopes are always tried, and an output is change when its recovered recipient is an address of the issuer's own full viewing key (either ZIP 32 scope, `IncomingViewingKey::diversifier_index` for Orchard/Ironwood, `decrypt_diversifier` for Sapling). `Recovered.is_change` is reported (`null` from the CLI when a bare `--ovk` cannot recognise change, with a warning). Regression test `zkool_batch_fixture_excludes_change_by_own_address` (3 receipts without `--include-change`, 4 with, change flagged, memos and values asserted). Residual cases are recorded in `docs/THREAT_MODEL.md` and RSK-20.

### Receipts after the fix (`scripts/regtest/issue-batch2.sh` → `raw/tools/regtest/issue-batch2.out`; JSON abridged to the recovered fields, receipts written to `raw/tools/regtest/receipts-batch2/`)

```
$ zeceipt issue --regtest --endpoint http://127.0.0.1:8137 --ufvk $(cat fixtures/regtest-issuer-ufvk.txt) --txid 48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2 --label 'batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG' --challenge auditor-nonce-12 --key-file $ARTIFACT_DIR/issuer.key --key-id 2026-09 --out-dir $ARTIFACT_DIR/receipts-batch2   (run from the repo root; ARTIFACT_DIR holds the signing key and receives the receipts)
{
  "height": 626,
  "receipts": [
    {
      "output_index": 1,
      "recovered": {
        "value_zec": "1.02000000",
        "memo": {
          "kind": "text",
          "text": "INV-R-003"
        },
        "recipient": "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
        "is_change": false
      }
    },
    {
      "output_index": 2,
      "recovered": {
        "value_zec": "1.01000000",
        "memo": {
          "kind": "text",
          "text": "INV-R-002"
        },
        "recipient": "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
        "is_change": false
      }
    },
    {
      "output_index": 3,
      "recovered": {
        "value_zec": "1.03000000",
        "memo": {
          "kind": "text",
          "text": "INV-R-004"
        },
        "recipient": "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
        "is_change": false
      }
    }
  ]
}
exit=0
```

### Verification matrix (`scripts/regtest/verify-batch2.sh` → `raw/tools/regtest/verify-batch2.out`, verbatim)

```
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 receipts-batch2/48db254a361e9676-ironwood-1.json --challenge auditor-nonce-12 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": 626,
  "issuer_pubkey": "935d7fd7a564f565a45834d9799336a8a5cbbedbac98519dd68cc0f80c00921b",
  "label": "batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG",
  "memo": {
    "kind": "text",
    "text": "INV-R-003"
  },
  "output_index": 1,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2",
  "valid": true,
  "value_zat": 102000000,
  "value_zec": "1.02000000"
}
exit=0
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-1.json --challenge auditor-nonce-12 --require-signature   (offline)
{"valid": true, "output_index": 1, "value_zec": "1.02000000", "memo": {"kind": "text", "text": "INV-R-003"}, "recipient": "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj"}
exit=0
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 receipts-batch2/48db254a361e9676-ironwood-2.json --challenge auditor-nonce-12 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": 626,
  "issuer_pubkey": "935d7fd7a564f565a45834d9799336a8a5cbbedbac98519dd68cc0f80c00921b",
  "label": "batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG",
  "memo": {
    "kind": "text",
    "text": "INV-R-002"
  },
  "output_index": 2,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2",
  "valid": true,
  "value_zat": 101000000,
  "value_zec": "1.01000000"
}
exit=0
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-2.json --challenge auditor-nonce-12 --require-signature   (offline)
{"valid": true, "output_index": 2, "value_zec": "1.01000000", "memo": {"kind": "text", "text": "INV-R-002"}, "recipient": "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w"}
exit=0
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 receipts-batch2/48db254a361e9676-ironwood-3.json --challenge auditor-nonce-12 --require-signature
{
  "challenge_checked": true,
  "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
  "height": 626,
  "issuer_pubkey": "935d7fd7a564f565a45834d9799336a8a5cbbedbac98519dd68cc0f80c00921b",
  "label": "batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG",
  "memo": {
    "kind": "text",
    "text": "INV-R-004"
  },
  "output_index": 3,
  "pool": "ironwood",
  "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
  "recipient": "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
  "txid": "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2",
  "valid": true,
  "value_zat": 103000000,
  "value_zec": "1.03000000"
}
exit=0
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-3.json --challenge auditor-nonce-12 --require-signature   (offline)
{"valid": true, "output_index": 3, "value_zec": "1.03000000", "memo": {"kind": "text", "text": "INV-R-004"}, "recipient": "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5"}
exit=0
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2.json --challenge auditor-nonce-12 --require-signature   (signed receipt, one ock byte flipped)
{"error":"signature is invalid","stage":"signature","valid":false}
exit=1
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2-unsigned.json --challenge auditor-nonce-12   (unsigned copy, ock byte flipped, signature not required)
{"error":"recovery failed: the ock does not open ironwood output 2","stage":"recovery","valid":false}
exit=1
$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-1.json --challenge auditor-nonce-13 --require-signature   (wrong challenge)
{"error":"challenge mismatch","stage":"challenge","valid":false}
exit=1
$ zeceipt pack --title 'batch 2026-09-22' receipts-batch2/*.json > pack-batch2.json
exit=0
$ zeceipt verify-pack --regtest pack-batch2.json --raw-tx-dir rawdir --challenge auditor-nonce-12 --require-signature
{
 "all_valid": true,
 "declared_total_zat": 0,
 "note": "verified total is a lower bound: receipts prove these payments exist, not that no others do",
 "title": "batch 2026-09-22",
 "verified_total_zat": 306000000
}
exit=0
```

Result: 3 receipts valid online and offline with signature and challenge; a flipped OCK byte fails at `signature` when signed and at `recovery` when unsigned; a wrong challenge fails at `challenge`; the audit pack recomputes 3.06 REG as a lower bound. REQ-CON-7's acceptance criterion ("regtest batch of 3 recipients lands in one transaction") is met at the backend level; the console-side adapter (typed client, batch nonce, status polling) is still to build.

## 5c. regtest — console library: idempotent submission and allow-listed auto-issuance (2026-09-23)

The tracer of §5b was a script; this section exercises the console's library code (`apps/console/lib/`, Trellis task `09-23-execution-adapter`) on the same regtest chain: `ZkoolBackend` (the `PayoutBackend` contract of `docs/product/05_data_model_api.md` §2) with a file-backed nonce store, and `autoIssue`, which waits for N confirmations, runs `zeceipt issue --only-to <each batch address>`, matches every receipt to its own batch item (memo, value, address, not change), verifies it, and only then writes the receipt files. Driver: the opt-in end-to-end test `apps/console/test/regtest.e2e.test.ts` (`ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts`, run from `apps/console`; procedure in `docs/REGTEST_RUNBOOK.md`), which creates three fresh Ironwood recipient accounts in Zkool, builds a batch with memos `INV-C-<stamp>-1..3` (0.21 / 0.22 / 0.23 REG), and asserts every step. N = 2 confirmations; `status` is polled every 5 s and every poll is logged. Transcript: `raw/tools/regtest/console-e2e-20260922194955.json` (outside the repository, like the other captures); the `log` array is quoted below verbatim, one JSON object per line. (Earlier runs on superseded code showed the same behaviour: stamp `20260922190614`, tx `623bfd29…bdb1` in block 1731, before review round 1; `20260922192547`, tx `6b615fe0…4991` in block 2074, before round 2; `20260922193633`, tx `9dab2080…e566` in block 2243, before round 3; `20260922194443`, tx `17679a4d…13ba` in block 2385, before round 4. This run, stamp `20260922194955`, is on the code under review.)

```
{"step": "refusal probe", "at_ms": 99, "message": "No feasible note selection found", "isPreBuildRefusal": true}
{"step": "preflight", "at_ms": 172, "ok": true, "problems": [], "totalZat": "66000000", "feeEstimateZat": "20000", "spendableZat": "87148035000", "height": 2465}
{"step": "submit #1", "at_ms": 4270, "txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "replayed": false, "via": "fresh"}
{"step": "submit #2 (same nonce)", "at_ms": 4270, "txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "replayed": true, "via": "record"}
{"step": "status", "at_ms": 4328, "state": "pending", "broadcastAt": "2026-09-22T19:49:59.179Z"}
{"step": "status", "at_ms": 9407, "state": "mined", "height": 2468, "confirmations": 2, "tip": 2469}
{"step": "chain check", "at_ms": 9408, "issuerTxsNew": 1, "minedHeight": 2468, "blockTx": ["5043b498bb53a9d3836c8305447856a824bf6539042eaa236bd7252e312ea423", "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419"]}
{"step": "expiry check", "at_ms": 9410, "expiryheight": 2505, "recordedExpiresBy": 2517, "intentHeight": 2465}
{"step": "submit #3 after mining (same nonce)", "at_ms": 9411, "txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "replayed": true, "via": "record"}
{"step": "autoIssue", "at_ms": 9462, "receipts": [{"payableId": "p-1", "outputIndex": 1, "value_zec": "0.21000000", "memo": "INV-C-20260922194955-1", "recipient": "uregtest19kcdc6jfzdegyan9avm2tdf3khh90hrnfgsp3djpzgvqkperzvnl3c879zp562pvu8hlzycucau4v2ma30d2fzhyqd255chxac3z55dk", "is_change": false, "verified": true}, {"payableId": "p-2", "outputIndex": 2, "value_zec": "0.22000000", "memo": "INV-C-20260922194955-2", "recipient": "uregtest1dzw383zwfpmnhqargw9uqc7xvgaj2ugf3zzrhyfn5y2g6zd5gdp5rc0gh57xcm5g0d3y7g5hgv2e079m4tlk8p6uvgjzknvkzseepxdv", "is_change": false, "verified": true}, {"payableId": "p-3", "outputIndex": 3, "value_zec": "0.23000000", "memo": "INV-C-20260922194955-3", "recipient": "uregtest13qsenzh0neatr6a0xvk99sv8qtgpeztahut506sughqtqutmpcnnj9060h7m2fjwf3qdqn7fu0kzxxf658fs440qks9dfxfacylu32n3", "is_change": false, "verified": true}], "skippedNotInAllowList": 0, "outDir": "<workspace>/raw/tools/regtest/console-receipts-20260922194955"}
{"step": "recipient views", "at_ms": 9622, "views": [[{"txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "notes": [{"value": "0.21000000", "memo": "INV-C-20260922194955-1"}]}], [{"txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "notes": [{"value": "0.22000000", "memo": "INV-C-20260922194955-2"}]}], [{"txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "notes": [{"value": "0.23000000", "memo": "INV-C-20260922194955-3"}]}]]}
```

What the log shows:

- **Refusal classification (live).** Before the batch, the test asks Zkool to pay 20,000,000 REG. The real answer, `No feasible note selection found`, is recognised by `isPreBuildRefusal` as a refusal raised before any transaction is built, so such a nonce may be retried at once. Any `pay` error not on that list (for example a gRPC failure while sending, which Zkool also reports as a GraphQL error) is treated as an unknown outcome instead (see "Failure paths" below).
- **Idempotency.** Submit #1 paid (`via: "fresh"`). Submit #2 with the same nonce, 1 ms later, returned the same txid without calling `pay` (`replayed: true, via: "record"`), and so did submit #3 after mining. The chain check proves it: the issuer gained exactly one transaction, and block 2468 holds exactly two transactions, the coinbase and `205c81ac…e419` (blocks 2467 and 2469 hold only a coinbase).
- **Status.** The poll right after broadcast (4.3 s) returned `pending`. The next poll (9.4 s) returned `mined` at height 2468 with 2 confirmations (tip 2469), which met N = 2. Earlier runs polled `pending` up to four times before `mined`; the number depends only on when the internal miner builds the next block.
- **Expiry bound (live).** The transaction's consensus `expiryheight` (from `getrawtransaction`) is 2505 = intent height 2465 + 40. The nonce record's `expiresBy` is 2517 = node tip after `pay` returned (2467; two blocks arrived during `pay`) + 40 + a 10-block reorg margin. The bound holds: the transaction cannot be mined above 2505 ≤ 2517. Earlier runs, before the margin, gave 2112 ≤ 2113, 2279 ≤ 2280 and 2422 ≤ 2422. This is the property that lets an uncertain attempt be retried safely, but only once the issuer account is *scanned* past `expiresBy` with no match mined. The node tip is not enough, because Zkool's `synchronizeAccount` returns the tip without scanning while another sync holds its lock.
- **Auto-issuance.** Exactly three receipts, one per batch item, each matched by memo and checked for value, recipient (the CLI reports which `--only-to` entry each output pays) and `is_change: false`, then verified with signature and challenge inside `autoIssue`. The change output was never issued: the CLI excludes it by ownership, and `--only-to` would have skipped it anyway. The three files in `raw/tools/regtest/console-receipts-20260922194955/` were written only after all of that passed.
- **Recipients.** Each fresh account sees its own memo on the note it received.

Independent re-verification of the three auto-issued receipt files over gRPC, and the fee Zkool recorded (`STAMP=20260922194955 TXID=205c81ac…e419 HEIGHT=2468 scripts/regtest/console-verify.sh` → `raw/tools/regtest/console-verify-20260922194955.out`, verbatim; the script prints each command exactly as it runs):

```
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 $ARTIFACT_DIR/console-receipts-20260922194955/205c81ac346cd146-ironwood-1.json --challenge auditor-20260922194955 --require-signature
{"valid": true, "height": 2468, "output_index": 1, "value_zec": "0.21000000", "memo": {"kind": "text", "text": "INV-C-20260922194955-1"}, "recipient": "uregtest19kcdc6jfzdegyan9avm2tdf3khh90hrnfgsp3djpzgvqkperzvnl3c879zp562pvu8hlzycucau4v2ma30d2fzhyqd255chxac3z55dk"}
exit=0
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 $ARTIFACT_DIR/console-receipts-20260922194955/205c81ac346cd146-ironwood-2.json --challenge auditor-20260922194955 --require-signature
{"valid": true, "height": 2468, "output_index": 2, "value_zec": "0.22000000", "memo": {"kind": "text", "text": "INV-C-20260922194955-2"}, "recipient": "uregtest1dzw383zwfpmnhqargw9uqc7xvgaj2ugf3zzrhyfn5y2g6zd5gdp5rc0gh57xcm5g0d3y7g5hgv2e079m4tlk8p6uvgjzknvkzseepxdv"}
exit=0
$ zeceipt verify --regtest --endpoint http://127.0.0.1:8137 $ARTIFACT_DIR/console-receipts-20260922194955/205c81ac346cd146-ironwood-3.json --challenge auditor-20260922194955 --require-signature
{"valid": true, "height": 2468, "output_index": 3, "value_zec": "0.23000000", "memo": {"kind": "text", "text": "INV-C-20260922194955-3"}, "recipient": "uregtest13qsenzh0neatr6a0xvk99sv8qtgpeztahut506sughqtqutmpcnnj9060h7m2fjwf3qdqn7fu0kzxxf658fs440qks9dfxfacylu32n3"}
exit=0
$ curl --noproxy '*' -s -X POST http://127.0.0.1:9000/graphql -H 'Content-Type: application/json' -d '{"query":"{ transactionsByAccount(idAccount: 9, height: 2468) { txid height value fee } }"}'   (filtered to 205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419)
[{"txid": "205c81ac346cd146185d594f97fc94e7f7a6d3faccc4426fb156f922b826e419", "height": 2468, "value": "-0.66020000", "fee": "0.00020000"}]
```

The recorded fee (0.00020000 REG = 20,000 zat for 3 recipients + change) equals the ZIP 317 estimate `5000 × max(2, n + 1)` that preflight used.

Failure paths that a live chain cannot produce on demand are covered by unit tests against an in-process fake Zkool that models the mempool and transaction expiry (`apps/console/test/zkool-backend.test.ts`):
- transport loss after broadcast;
- a GraphQL error after the tx reached the node (reconciled once mined, never paid again);
- a GraphQL error or a node rejection with nothing sent (uncertain until the account is scanned past `expiresBy`, then exactly one more payment);
- a sync that returns the tip without scanning while the lost transaction is already mined (no second payment; reconciled once scanned);
- an expired broadcast, re-sent only through `resubmitExpired`;
- compare-and-set record updates, so a stale writer cannot overwrite a newer attempt;
- a retry claimer that died before advancing the record (its stale claim and stale lock are recovered, with exactly one payment);
- a store failure right after a successful pay (surfaced as `UnknownOutcomeError`, reconciled later);
- a file-store writer suspended past the lock lease (it writes nothing over the new holder);
- a known pre-build refusal (retried at once);
- a look-alike transaction paying the batch's memos and values to other addresses, which is not accepted as the batch;
- two OS processes racing on one nonce;
- stale intents;
- pending timeout and expiry.

`autoIssue`'s fail-closed cases (value, memo or payee mismatch, a duplicate claim of one output, and no files written on failure) run against the real `zeceipt` binary on the committed Zkool fixture (`apps/console/test/auto-issue.test.ts`). Both suites run in CI.

## 6. testnet — placeholder

To be recorded once the faucet claim in §4 is made: txid, receipt URL, `verify --testnet` output and one tampered copy at exit 1.
