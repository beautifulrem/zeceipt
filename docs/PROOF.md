# Proof log

Every claim in the README is backed by an entry here. Entries are labelled by evidence class:

- **mainnet-read**: real mainnet data fetched and parsed; no keys involved.
- **synthetic**: a real mainnet v6 transaction with one Ironwood action re-encrypted to a key we control. Cryptographically complete for the receipt (the note, memo and OCK are genuine), but the transaction is **not consensus-valid** and is not on chain. Used for issue → verify → tamper end-to-end without funds.
- **regtest**: a consensus-valid transaction built by a real wallet and mined by a real Zebra node on a private regtest chain, indexed by Zaino, issued through the UFVK path and read back over gRPC (§5). Everything a public-chain proof shows except "exists on a public chain".
- **testnet** / **mainnet-write**: a transaction we sent on a public chain. Not yet recorded — blocked on a faucet claim (see §4, §6).

Links in outputs recorded before 2026-09-25 are on `https://zeceipt.xyz`, then the CLI's default host. That domain is not registered (WBS 4.1.1.2), and since slice S2 neither the CLI nor the console has a default host: the page a host serves reads the link's fragment, so the operator names a host they control (`docs/THREAT_MODEL.md`, the link host). The recorded outputs are kept as they were produced. Likewise, outputs recorded before slice D5 (2026-09-26) say `"proves": "…; the issuer knew this output's OCK"`. That overstated the claim, because anyone holding an earlier receipt for the output also knows its OCK (review D2, spec §4). Since D5 the CLI and the browser verifier say "whoever produced this receipt knew this output's OCK, as does anyone holding an earlier receipt for it; a signature attributes the receipt to a key, not the OCK to the sender".

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

> Links in the transcripts of §2–§5c were recorded before slice F1 (2026-09-23) and use the v0 path form `…/r/<payload>`. Issuers now emit `…/r#<payload>` (spec §2.1); verifiers still accept both. Don't copy the path form.

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

Rebuilt 2026-09-23 for slice F1 (links carry the payload in the fragment, spec §2.1): 704,343 bytes. The size changed with the toolchain (rustc 1.96.0, wasm-pack 0.15.0, Homebrew LLVM 23 clang for `secp256k1-sys`), and the JavaScript glue is byte-identical. `node packages/verify/test/verify.mjs`: ALL OK, including the new `url_forms` checks. With the 2026-09-22 build the fragment and `#<payload>` checks fail ("URL does not contain a receipt payload"), which is the negative control. Driven again in Chrome (playwright-core, `channel: "chrome"`) with the synthetic receipt, the raw tx, challenge `auditor-nonce-7` and signature required:

| receipt input | result shown by the page |
|---|---|
| `https://zeceipt.xyz/r#<payload>` | **VALID**, txid `4f3cc1ae…1b7f` |
| `https://zeceipt.xyz/r/<payload>` (v0 path form) | **VALID**, the same |
| `https://zeceipt.xyz/r#` | **INVALID**, failed at `parse`: URL does not contain a receipt payload |

Chain status (slice F2a, 2026-09-23). `fetchRawTx` now reports what the node said, from lightwalletd's `RawTransaction.height` sentinels (`walletrpc/service.proto`): `{status: "mined", height}`, `{status: "mempool"}` (0 or absent), or `{status: "fork"}` (0xffffffffffffffff). Before, a fork was shown as "mined at height 18446744073709552000". The node guard covers the three cases and more over hand-built gRPC-web responses; the previous wrapper fails them (the negative control). In Chrome, with the node's responses intercepted, the demo's status line reads "mined at height 3491284", "in the mempool, not mined yet" and "on a fork, not the main chain". Live, `zjs.zec.rocks/mainnet` gives `{status: "mined", height: 3491284}` for `0e85513c…da69`.

The timings below were measured on the 2026-09-22 build. Since then, the crates changed only in `Receipt::parse`/`to_url` (this slice) and the allow-list helpers `shielded_receivers`/`pays_any` in `zeceipt-core`, which no WASM export calls. Verification itself is unchanged.

Timing (2026-09-22, NFR-4). Chrome 153 on `demo/index.html` served locally, `performance.now()` around `verifyReceipt` from `src/index.js`, 20-run averages, signed and challenge-bound receipts: **7.28 ms** on the synthetic fixture (9,166-byte tx) and **6.05 ms** on the Zkool batch fixture `regtest-48db254a…` (15,478 bytes, 4 Ironwood actions, receipt for output 1). 69 % more bytes cost no more time: verification decrypts exactly one output, so the cost is dominated by that single trial decryption and is roughly flat in transaction size across 9–15 KB. At 6–7 ms the measurement is **more than 130× inside the 1 s budget**; the remaining 23 % to the NFR's 20 KB bound is not measured but cannot plausibly change that order of magnitude. Node 26 on the committed wasm: init 13.9 ms; `verify_receipt` 4.11 ms (regtest fixture) / 3.19 ms (synthetic). CLI (release build, `/usr/bin/time`): `zeceipt inspect --txid 0e85513c…da69` fetching the mainnet tx from `zec.rocks` over gRPC/TLS 1.15 s wall; `zeceipt issue --regtest --raw-tx-file … --ufvk …` (trial-decrypt of both outputs + signing, offline) 0.00 s wall; `zeceipt verify --regtest --raw-tx-file …` offline 0.01 s. So a public-node `issue` is fetch-bound at ≈ 1–2 s. The page shows the mined height for fetched transactions and tells the user to confirm depth on an explorer or their own node; it does not compute confirmations itself.

Timing at the bound (2026-09-28, slice P3). `packages/verify/test/timing.mjs` (`npm run test:timing` in `packages/verify`) repeats the measurement on four committed transaction and receipt pairs, through the package's entry point: in Chrome 154 (served locally) and in Node 26, 20 runs after one warm-up call, signed and challenge-bound receipts. Every run was valid:

| Fixture | Bytes | Chrome mean / max | Node mean / max |
|---|---|---|---|
| synthetic (`synthetic-ironwood.hex`, `synthetic-receipt.json`) | 9,166 | 3.36 / 3.90 ms | 3.69 / 5.76 ms |
| zcash-devtool payment (`regtest-48be62e2….hex`, `regtest-receipt.json`) | 9,166 | 3.02 / 3.60 ms | 3.42 / 6.28 ms |
| Zkool batch (`regtest-48db254a….hex`, `regtest-zkool-batch-receipt.json`) | 15,478 | 3.20 / 4.10 ms | 3.59 / 4.85 ms |
| console batch of five payments (`regtest-58794a9b….hex`, `regtest-20kb-receipt.json`) | 21,790 | 3.41 / 4.20 ms | 4.05 / 6.33 ms |

Maxima vary by a few milliseconds between runs (the review's own run peaked at 5.90 ms in Chrome, on the synthetic fixture). The largest is a consensus-valid regtest transaction (six Ironwood outputs), above NFR-4's 20 KB bound, so the bound is now measured rather than argued; the cost stays flat in size. A correction: the 6.05 ms above for the Zkool batch used a receipt that was not committed (the committed `regtest-receipt.json` belongs to the zcash-devtool transaction `48be62e2…`); `regtest-zkool-batch-receipt.json` now makes that pair reproducible.

## 2c. synthetic + regtest — the public receipt page in Chrome (2026-09-23)

The page a receipt link opens: `packages/verify/r/` (slice F2b, Trellis `09-23-public-receipt-page`), static, served at `/r/` from the same root as the demo (`npm run demo`, then `http://localhost:8787/r/#<payload>`). It reads the receipt from the link's fragment (spec §2.1) and verifies it with the committed WASM through `src/index.js`, the wrapper npm users get.

Command: `cd packages/verify && npm ci && ZECEIPT_BROWSER_E2E=1 node --test test/page.e2e.mjs` (also in CI).
- The test serves the package with a small static host that redirects `/r` to `/r/`, as static hosts do.
- It drives the installed Google Chrome (playwright-core 1.63).
- It answers `zjs.zec.rocks` with hand-built gRPC-web responses from the committed fixtures, so no internet is needed.
- Result: **8/8 pass.**

| Opened | What the page shows |
|---|---|
| `/r#<signed bearer receipt>` (issued for this test from the synthetic tx with a throwaway key; `demo/fixtures/synthetic-receipt-bearer.json`) | It lands on `/r/#…`: the redirect keeps the fragment (RFC 9110 §10.2.2). The summary (network, txid, output, label, "present, key …", "none (a bearer receipt…)") shows before any outside request. The fetch note names `zjs.zec.rocks/mainnet, then zcash-mainnet.chainsafe.dev`. After the click: **VALID**, 2.50000000 ZEC (250000000 zat), memo `INV-2026-0142`; "Mined at height 3491284, according to zjs.zec.rocks/mainnet. This page does not count confirmations: check the depth on an explorer or your own node."; "Signed by key … (key id 2026-09)"; "issuer binding: unknown"; "Not bound to a challenge: this does not prove who is showing it to you." Exactly one outside request: `GetTransaction`. |
| the same, with the node answering height 0 / 0xffffffffffffffff | VALID, with inclusion "Pending: … in the mempool; it is not mined yet" / "Not on the main chain: … mined on a fork" (amber). |
| the same, with the node lacking the transaction | 04's pending copy, "The transaction was not found yet…", and no outcome. Both live public nodes answer an unknown txid with `grpc-status: 5`, which the wrapper now reports as not found `[R68]`. |
| `fixtures/synthetic-receipt.json` (challenge-bound) | The challenge input appears; after the fetch, "Enter the challenge you sent, then Verify". A wrong challenge gives **INVALID** with 04's challenge copy; `auditor-nonce-7` gives VALID and "Bound to your challenge, and it matched". |
| the bearer receipt with its label edited | **INVALID**, 04's signature copy. |
| an unsigned receipt with label `x <b>bold</b> y`, via `location.hash =` in the same tab (no reload) | The page re-renders on `hashchange`. VALID, "Unsigned: the label is the sender's unauthenticated text…". The label shows literally, and there is no `<b>` element in the page. |
| `fixtures/regtest-receipt.json` | No fetch button: "No public node serves the local regtest chain (development only). Load the raw transaction from a file instead." Challenge `auditor-nonce-9`, then the file `fixtures/regtest-48be62e2….hex`: VALID, 2.50000000, "Unknown: the transaction was loaded from a file…", with the amber border: green only when a node reports the transaction mined (review F2b round 1). No outside request. |
| `/r/`, `/r/#`, `/r/#hello` | "This link has no receipt in it" (twice); then **INVALID** with 04's parse copy. |
| the WASM request held back | "Loading the verifier…" with "What a valid result proves" and "What it does not prove" already on screen. |

Privacy, checked after every case above:
- no request URL, header or body the page sent, and nothing the host received, contains any test receipt's payload or OCK;
- the only outside request is `GetTransaction` with no `Referer`;
- `localStorage`, `sessionStorage`, cookies, IndexedDB and Cache Storage are empty;
- no CSP violation and no page error.

Negative controls: each of three leaks planted in `r/page.js` in turn failed the first test.
- `fetch("/beacon?" + location.hash.slice(1))` → "a request carried a receipt secret";
- `localStorage.setItem(…)` → `local: 1`;
- `fetch("https://example.com/x")` → a CSP violation.

The node guard also checks:
- `view.js` (the stage copy, the three parts);
- that the page has no inline script or style;
- the no-referrer meta;
- that the CSP `connect-src` covers every `GRPC_WEB_ENDPOINTS` origin (removing one fails it);
- that `page.js` uses no `innerHTML` and no storage.

The source guards now scan `packages/verify/src` and `r/` too; an OCK in a `console.log` there fails them.

## 2e. synthetic — the receipt page's issuer check in Chrome (2026-09-26, slice W3b)

`ZECEIPT_BROWSER_E2E=1 node --test packages/verify/test/page.e2e.mjs` passes 12/12, 4 of them new.

The fixture receipt claims `pay.example.org`, from key id `2026-09@pay.example.org`, signed with a throwaway key that was deleted. The domain's well-known file is served by interception in the browser.

| Case | What the page shows |
|---|---|
| Before a result | No check is offered |
| After VALID | "Check with pay.example.org", and a note that the check tells pay.example.org one of its receipts is being checked. No request goes to the domain before the click |
| Clicked, the domain's file | "Confirmed: pay.example.org lists this key. It vouches for the key now; this does not say when the receipt was made." (green) |
| Another key's file | "Not listed: pay.example.org does not list this key. The payment above is still proven…" (amber) |
| A redirect | "Unknown: pay.example.org: the request failed…" (amber); the redirect target is never requested |
| A 404 | "Unknown: pay.example.org answered HTTP 404" (amber) |
| A plain key id, or unsigned | No check is offered |

In every case the headline stays VALID. The check is a single GET with no `Referer` and no cookie, and no receipt payload or OCK is in any request (the privacy assertions of §2c).

**CSP, measured.** `https://evil.example/other` is refused, and the well-known path is admitted. The well-known path with a query string is also admitted, and plain `http:` is refused. Admitting the query is the recorded cost of this widening (THREAT_MODEL).

**Against a real origin (slice W3c).** Playwright's interception bypasses Chrome's CORS check, so a 13th test launches a second Chrome with `--host-resolver-rules=MAP pay.example.org:443 127.0.0.1:<port>` and `--no-proxy-server`. `pay.example.org` then reaches a local HTTPS server whose certificate is made for the run in a temporary directory; the context accepts it.
- **Without `Access-Control-Allow-Origin`:** Chrome's own CORS policy blocks the read ("…has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header…"), and the page says "Unknown: pay.example.org: the request failed…".
- **With the header:** Confirmed.
- **A real 302:** Unknown, and the server sees exactly one request.

In each case the headline stays VALID. Without `--no-proxy-server`, the machine's system proxy took the request and the mapping never applied (measured).

## 2d. mainnet-read — the issuer binding lookup over the internet (2026-09-26, slice W2b)

`zeceipt verify --check-issuer` on a receipt issued from the synthetic fixture with a throwaway key and the key id `2026-09@example.org`:

```
$ zeceipt verify <receipt> --raw-tx-file fixtures/synthetic-ironwood.hex --check-issuer
{ "valid": true, …, "issuer_binding": { "state": "unknown", "reason": "example.org answered HTTP 404" } }
```

The system resolver gave a public address (104.20.26.136), and TLS was verified against the web PKI roots with the name `example.org`. The GET for `/.well-known/zeceipt.json` completed and was answered 404. example.org publishes no file, so the binding is unknown, and `valid` stays true. This shows the live path: resolution, the public-address check, the pinned connection, TLS and the HTTP rules. The confirmed and not-listed outcomes are shown offline with `--issuer-file` (`verify_reports_the_issuer_binding_and_never_changes_validity`), because no public domain serves a `zeceipt.json` yet (registering `zeceipt.xyz` is WBS 4.1.1.2, the user's).

## 3. unit — protocol-level round trip

`ironwood_round_trip_ock_derivation_and_recovery`: encrypt a V3 (Ironwood) note with a random FVK using the `orchard` crate's `IronwoodNoteEncryption`, derive the OCK with `Domain::derive_ock`, recover with `try_output_recovery_with_ock`, and check that a flipped OCK bit and another key's OCK both fail.

## 4. testnet — rehearsed, waiting on a faucet claim (the user's call)

A testnet light wallet was created with `zcash-devtool` (built from source at `raw/tools/zcash-devtool`, wallet dir `raw/tools/testnet-wallet`, mnemonic encrypted to a local age identity; nothing from it is in this repository):

- Account `c1637de7-cd41-4567-9a61-7383aea12f90`, birthday height 4375968
- Receiving address (testnet UA): `utest1jlj43jsyqkek9nwnt80p50dl4tr4helrvlvh7fwykpalnn0y7xz2z4f9xhemvgrn5rnacu8h7r70tneqf78d20yzlm2rf7580fu6shql0s7520p99gu9sdq4y5rcqd4kf6rwjwu698pm4vq6g7k5mxyqcy8p6uq7xa8de3446al7chh5x5hpf0tare89x2898kvlzxfzef49vwyzhjt`
- UFVK: `uviewtest1llrzcdcc6v26y5rppkmff3mcu2sd0lyfkalt82qlsr5fxwc9842t8v3lyz02lnhtkuufze5x8t33gj3e9j6dlv4xk86vjp3c4ar9dxd2mj2vp2zp0g0ua2cwhzhju8eaqxcdvh963dun3d7uujpvg97w509nhm8ywlaudyf0637arudw5625usjq4gnw9rf7a29e7624m4dldsyj2tp2zjp6fnwfz7nt03syt8ns24k57lz7qsd8slv3vd8t2dwcqnxxewyccea50zmdqkm7jjc48uf3k4szg4uftlwtgvf3zu8tfgxmpzg99akzk3mtah77775vqkhv0z8vr3axphkflex8gvrlagjllx9xayp7yyyv5ajgyt3qfvkrx8qahz3urepkd4dk6eaau5mtq75m4t445808n47fmnuwcgf4ra64j66c325ax89z366um62k7jw6wtefux084ndd64rzdgm7e3mxuhchcmurl37nrxz9e55g24wh`

**Rehearsed without funds on 2026-09-28 (slice RB1, `[R126]`), up to the funding step.** The wallet synced from its birthday to the tip (4,407,531) in 42 s against `testnet.zec.rocks`, with a balance of 0; `propose` for 0.01 TAZ stopped only at "Insufficient balance (have 0, need 1010000 including fee)" (the ZIP 317 fee, 10,000 zat); and `zeceipt inspect --testnet` read a live v6 transaction with two Ironwood outputs (`6e01882b…dbf5`, height 4,407,227) from the CLI's default endpoint.

Remaining step (3.4.1.4), the user's call: claim TAZ into the receiving address above. `https://fauzec.com` gives 1 TAZ per address every 24 hours, to Unified or Sapling addresses; its web form uses Cloudflare Turnstile, but its documented API omits the human check "for now while we settle the long-term automation policy" (its FAQ, read 2026-09-28), so one command claims (below). `https://zcashfaucet.jinolabs.xyz` gives 0.1 TAZ per 24 hours behind a browser puzzle (its page was served on 09-28; its status panel fills in client-side). One fauzec drip pays for well over three receipts.

Then, from the workspace root (paths only: the age identity and the issuer key are never printed or copied):

```bash
D=raw/tools/zcash-devtool/target/release/zcash-devtool; W=raw/tools/testnet-wallet; Z=zeceipt/target/release/zeceipt
# The claim (fauzec's API; poll the returned request_id until it is terminal):
curl -sS https://fauzec.com/api/v1/claim -H 'content-type: application/json' --data '{"network":"testnet","address":"<the receiving address above>"}'
curl -sS https://fauzec.com/api/v1/status/testnet/<request_id>
$D wallet -w $W sync && $D wallet -w $W balance                       # spendable after 10 confirmations (about 12.5 min)
# A recipient that is not the issuer: a payment to the issuer's own address is change, which `issue` skips.
$D wallet -w $W generate-account -i $W/identity.txt --name recipient   # then list-addresses for its UA
# With two accounts, name the paying one (the issuer, account 0 above) in both commands:
$D wallet -w $W propose --address <recipient utest…> --value 1000000 c1637de7-cd41-4567-9a61-7383aea12f90   # dry run: nothing signed
$D wallet -w $W send -i $W/identity.txt --address <recipient utest…> --value 1000000 --memo "INV-T-001" c1637de7-cd41-4567-9a61-7383aea12f90
# Repeat the send with INV-T-002 and INV-T-003 for three receipts (the solo target, `11_plan.md` §4): each waits
# for the previous send's change to reach 3 confirmations (devtool's default policy: 3 trusted, 10 untrusted).
# The UFVK above, saved to a file outside this repository, keeps it off the process list:
$Z keygen --out <issuer.key path>                                     # only if there is no testnet issuer key yet
$Z issue --testnet --txid <txid> --ufvk-file raw/tools/testnet-wallet/ufvk.txt --key-file <issuer.key path> --label "INV-T-001" --host <the receipt page's host> --out-dir receipts
$Z verify --testnet --require-signature receipts/<file>.json         # exit 0, with the block height
# One tampered copy (the first character of the OCK changed, as in §5) must exit 1.
```

- **Before NU7 activates on testnet, on 2026-10-06** (announced; ZIP 259's height is assigned on 10-05). This build refuses NU7's branch (slice U1a), so the run's transactions must be mined before activation; receipts for them keep verifying after it, since the branch is read from each transaction's own header `[R121]` `[R128]`.
- **Endpoints.** The CLI's only testnet default is `testnet.zec.rocks`; if it is down, `--endpoint https://zaino.testnet.unsafe.zec.rocks:443` answered the same `inspect` (zec.rocks' experimental Zaino, the same operator, so not a default). ChainSafe's testnet endpoint serves gRPC-web only (native gRPC gets HTTP 464): it is the receipt page's fallback, not the CLI's `[R125]` `[R126]`.
- **The receipt page** fetches a testnet transaction from `zjs.zec.rocks/testnet`, then ChainSafe's (slice RS4); open one link there and record its outcome.

Record the txids, the receipt URLs' hosts, the `verify` outputs (never an OCK) and the tampered copy's exit code in §6 as a **testnet** entry.

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

The tracer of §5b was a script; this section exercises the console's library code (`apps/console/lib/`, Trellis task `09-23-execution-adapter`) on the same regtest chain: `ZkoolBackend` (the `PayoutBackend` contract of `docs/product/05_data_model_api.md` §2) with a file-backed nonce store, and `autoIssue`, which waits for N confirmations, runs `zeceipt issue --only-to <each batch address>`, matches every receipt to its own batch item (memo, value, address, not change), verifies it, and only then writes the receipt files. Driver: the opt-in end-to-end test `apps/console/test/regtest.e2e.test.ts` (`ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts`, run from `apps/console`; procedure in `docs/REGTEST_RUNBOOK.md`), which creates three fresh Ironwood recipient accounts in Zkool, builds a batch with memos `INV-C-<stamp>-1..3` (0.21 / 0.22 / 0.23 REG), and asserts every step. N = 2 confirmations; `status` is polled every 5 s and every poll is logged. Transcript: `raw/tools/regtest/console-e2e-20260922194955.json` (outside the repository, like the other captures); the `log` array is quoted below verbatim, one JSON object per line. (Earlier runs on superseded code showed the same behaviour: stamp `20260922190614`, tx `623bfd29…bdb1` in block 1731, before review round 1; `20260922192547`, tx `6b615fe0…4991` in block 2074, before round 2; `20260922193633`, tx `9dab2080…e566` in block 2243, before round 3; `20260922194443`, tx `17679a4d…13ba` in block 2385, before round 4. This run, stamp `20260922194955`, is on commit 6e9dc2a, which review round 5 scored 100/100; the one later change, which removes the lock file on exit only if this writer still owns it, touches only the lock path and not the payment path.)

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
- **Expiry bound (live).** The transaction's consensus `expiryheight` (from `getrawtransaction`) is 2505 = Zkool's build-time node tip 2465 + 40 (Zkool derives expiry from its tip when it builds; here that also equals the intent height, because the account was fully scanned at preflight). The nonce record's `expiresBy` is 2517 = node tip after `pay` returned (2467; two blocks arrived during `pay`) + 40 + a 10-block reorg margin. The bound holds: the transaction cannot be mined above 2505 ≤ 2517. Earlier runs, before the margin, gave 2112 ≤ 2113, 2279 ≤ 2280 and 2422 ≤ 2422. This is the property that lets an uncertain attempt be retried safely, but only once the issuer account is *scanned* past `expiresBy` with no match mined. The node tip is not enough, because Zkool's `synchronizeAccount` returns the tip without scanning while another sync holds its lock.
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


## 5d. regtest — the console app, driven through its pages like a user without JavaScript (2026-09-23)

§5c exercised the console's library; this section drives the **built console** (`next build`, then `next start`, Trellis task `09-23-console-regtest-http`, slice E3) on the same local chain, through HTTP only, and checks the results independently of it. The stack is the one of `docs/REGTEST_RUNBOOK.md`: zebrad (internal miner), zainod on 8137, zkool_graphql on 9000 with the issuer restored as account 9.

The console runs in hot custody (Zkool account 9), on regtest, with 2 confirmations. It uses zainod as its lightwalletd, the committed issuer UFVK fixture, and `issuer.key` from the artifact directory outside the repository. It uses **a wrap key generated for the run and a temporary database removed at the end**, so the run's receipts (bearer OCKs) do not outlive it.

The steps:
1. Three fresh recipient accounts are created in Zkool, Ironwood only.
2. The draft is created with the `/batches/new` form: a multipart post, as a browser without JavaScript sends it.
3. The batch page's Pay form is posted, then posted again.
4. The console's status API is polled until `confirmed`.
5. The page's Issue receipts form is posted.
6. The receipts are listed through the API and each is verified with `zeceipt verify - --regtest --endpoint http://127.0.0.1:8137 --require-signature`, on stdin. Since slice F1 (2026-09-23) the input is the receipt's shareable link, which must be a fragment link (`/r#<payload>`, spec §2.1); before that it was the receipt JSON.
7. Each recipient's own Zkool account is read.

Command: `ZECEIPT_REGTEST=1 NO_PROXY='*' node --test test/regtest.http.e2e.test.ts` (from `apps/console`). Transcript of the run below: `raw/tools/regtest/console-http-e2e-20260923012757.json` (outside the repository; public facts only). Earlier runs gave the same results: `…-20260923012322.json` (tx `6e5411de…`), and the reviewer's own run `…-20260923012624.json` (tx `f910eebe…`).

```
{"step": "recipients", "at_ms": 43, "accounts": [34, 35, 36], "birth": 2679}
{"step": "created", "at_ms": 414, "batchId": "01a0cbe0-6beb-798f-a0e7-8b368bbd33a0", "totalZat": "66000001", "memos": ["INV-H-20260923012757-1", "INV-H-20260923012757-2", "INV-H-20260923012757-3"]}
{"step": "paid", "at_ms": 2774, "txid": "f8ddd0a4ace48aa26b946a8ca1ed200630ca5e8160c382a1fc04fd8c03fd00d8", "state": "pending", "height": 2681}
{"step": "confirmed", "at_ms": 8943, "confirmations": 2, "height": 2683, "heightBeforePay": 2680, "issuerTransactionsSince": [{"txid": "f8ddd0a4ace48aa26b946a8ca1ed200630ca5e8160c382a1fc04fd8c03fd00d8", "height": 2682}]}
{"step": "receipts", "at_ms": 9023, "verdicts": [{"payableId": "P-1", "outputIndex": 3, "valueZat": "21000000", "memo": "INV-H-20260923012757-1", "valid": true, "recoveredValue": 21000000, "recoveredMemo": "INV-H-20260923012757-1"}, {"payableId": "P-2", "outputIndex": 1, "valueZat": "22000000", "memo": "INV-H-20260923012757-2", "valid": true, "recoveredValue": 22000000, "recoveredMemo": "INV-H-20260923012757-2"}, {"payableId": "P-3", "outputIndex": 2, "valueZat": "23000001", "memo": "INV-H-20260923012757-3", "valid": true, "recoveredValue": 23000001, "recoveredMemo": "INV-H-20260923012757-3"}]}
{"step": "recipients_received", "at_ms": 9193, "received": [{"account": 34, "value": "0.21000000", "memo": "INV-H-20260923012757-1"}, {"account": 35, "value": "0.22000000", "memo": "INV-H-20260923012757-2"}, {"account": 36, "value": "0.23000001", "memo": "INV-H-20260923012757-3"}]}
```

What the log shows:

- **The form creates exact amounts.** "0.23000001" ZEC typed into the form became 23000001 zatoshi; the total is 66000001.
- **Paid once for two posts of the pay form.** The status kept txid `f8ddd0a4…` after the repost. The issuer's transactions mined above the pre-pay height 2680 are exactly this one (`issuerTransactionsSince`, mined at 2682).
- **The derived status follows the chain.** The status went from `pending` at height 2681 to `confirmed` (2 confirmations) at 2683, read by the console itself (B3; it syncs Zkool on each read). It then became `receipts_issued` after the Issue form.
- **Three receipts verify online against zainod, with the issuer's signature required.** Each verification recovered exactly the batch item's memo and value (outputs 3, 1, 2 of the transaction). None binds a challenge (`challenge_checked: false`): console receipts are bearer links (slice D3). This check uses the same `zeceipt` codebase that issued the receipts, re-deriving everything from zainod's chain data, so it is independent of the console but not of our code.
- **Each recipient's own wallet holds its memo and exact amount** (asserted: the note's value equals the item's zatoshi). This is the check independent of our code.
- **Nothing secret was written.** The test checked that neither the transcript nor the server's output contains any receipt link or raw OCK, or the run's wrap key.
- **Later strengthening (review round 2).** The one-payment check also counts the issuer's unmined transactions, and requires zebrad's mempool to be empty (`getrawmempool` = `[]`). The run `console-http-e2e-20260923013026.json` passed with it: tx `03cdeae5…`, the only issuer transaction since pre-pay height 2716, and `mempool: 0`.
- **The full loop: console → link → public page (slice F3).** The run `console-http-e2e-20260923032333.json`:
  - tx `550dd74f…59b0`, paid at 4573 and confirmed (2) at 4575;
  - the only issuer transaction since the pre-pay height, with the mempool empty;
  - three receipts verified by the CLI, and each recipient holding its memo and exact amount.

  The console ran with `ZECEIPT_RECEIPT_HOST` set to a local static host serving `packages/verify/`. Every console link was `<that host>/r#…` (asserted without printing it). Each link was opened on the public receipt page in Chrome, with the raw transaction from zebrad loaded as a file. From the `page` step:

  ```
  {"step": "page", "host": "http://127.0.0.1:58496", "requestsToHost": 22, "pages": [{"payableId": "P-1", "headline": "VALID", "memoShown": "INV-H-20260923032333-1", "valueZatShown": "21000000", "inclusion": "unknown (file)"}, {"payableId": "P-2", "headline": "VALID", "memoShown": "INV-H-20260923032333-2", "valueZatShown": "22000000", "inclusion": "unknown (file)"}, {"payableId": "P-3", "headline": "VALID", "memoShown": "INV-H-20260923032333-3", "valueZatShown": "23000001", "inclusion": "unknown (file)"}]}
  ```

  - **What each page showed:** VALID, that item's memo and exact zatoshi, and the issuer's signature with key id 2026-09.
  - **No outside requests:** none were made (a file load).
  - **No leaks:** no request the page made, and none of the 22 the host received, carried any receipt payload or OCK.
  - **Opened exactly as printed (review F3 round 1).** Re-run `console-http-e2e-20260923032735.json` opened each link exactly as the console printed it. The host redirected `/r` to `/r/` with the fragment kept, and all 3 pages showed VALID; none of the 25 host requests carried a receipt.

- **Rate lock before paying (slice G2b1).** From run `console-http-e2e-20260923041713.json` on, the run locks the rate with the batch page's own form before the Pay form: a `locked` step, then tx `f6691a5c…`, confirmed, 3 pages VALID. A local fake ticker (steady 1600.00) keeps the run deterministic and offline; the live source is exercised in G1c1's run (Kraken through `next start`).
- **Fragment links (slice F1).** Re-run with the rebuilt CLI: `console-http-e2e-20260923014326.json`, tx `953b2718…` at 2875, confirmed at 2878. Each console link is `https://zeceipt.xyz/r#…` (asserted without printing it), and each link verifies online as given (outputs 2, 0, 3).

- **Approval and the audit trail on the live chain (slices I3, I4; 2026-09-25).** Run `console-http-e2e-20260925134853.json` (tx `16532b36…0c88`):
  - the rate was locked with the page's form at 1600.00 from the run's local fake ticker (deterministic, offline; since slice N1 the page names such a quote by its host, never as Kraken's);
  - the batch was approved with the page's Approve form at lock 1, and the status became `approved` before Pay;
  - the Pay form was posted twice: broadcast at tip 48056, mined at 48058, confirmed (2) at tip 48059 (the heights are the chain tip when the status was read, except "mined"); the only issuer transaction since the pre-pay height, with the mempool empty;
  - `GET /api/batches/{id}/history` held exactly `created, locked, approved, quoted, attempt_submitting, attempt_broadcast, expiry_recorded, receipt_issued ×3`: the approval at lock 1, the guard's execution quote, one attempt for two posts of the Pay form (the second replayed the record and changed nothing the trail tracks), the broadcast event naming the transaction, and one receipt event per line (outputs 3, 2, 1), each naming the transaction;
  - three receipts verified by the CLI with the issuer's signature required, and three receipt pages VALID in Chrome with no request carrying a receipt.

## 5e. regtest — Zkool enforces tokens; the console pays with a token scoped to its account (2026-09-25, slice S3)

Before this, Zkool ran without `--jwt-public-key-file`: `lsof` showed `zkool_graphql … TCP *:9000 (LISTEN)`, and an unauthenticated `{ currentHeight }` on 127.0.0.1 answered. From the machine's LAN address the request timed out, only because macOS's application firewall is on. Zkool was restarted with an ES256 public key (`raw/tools/regtest/zkool-jwt/`, outside the repository). The console's token was minted with `scripts/zkool-token.ts` (account 9, write, 30 days, a new 0600 file); the test harness has an admin token for creating recipients. No token was printed. Measured with `curl`:

| request | answer |
|---|---|
| no token (`currentHeight`; `balanceByAccount(9)`) | HTTP 500 `Unhandled rejection: AuthError` |
| a garbage token; an expired token (account 9) | HTTP 500 `Unhandled rejection: AuthError` |
| account 1's token reading `balanceByAccount(9)` | 200, GraphQL error `Unauthorized` |
| a read-only token for account 9 calling `pay` | 200, GraphQL error `Unauthorized` (nothing built: `check_auth` runs first) |
| account 9's token: `balanceByAccount(9)`, `currentHeight` | served |

Then the same run as §5d, through the console with `ZECEIPT_ZKOOL_TOKEN_FILE` (`ZECEIPT_REGTEST=1 node --test test/regtest.http.e2e.test.ts`; `raw/tools/regtest/console-http-e2e-20260925173141.json`):
- its first step asserts that this Zkool refuses a request without a token (500, `Unhandled rejection: AuthError`);
- a batch of 3 made on the form, locked (the run's local ticker, 1600.00), approved, paid once for two Pay posts: tx `ec0fecd3…6519`, mined at 50588;
- confirmed at 2, 3 receipts issued and verified; each recipient's own account holds its memo;
- each link VALID on the receipt page.

The library test (§5c) passed the same way, paying with the issuer's scoped token (`test/regtest.e2e.test.ts`). Since slice S3b, every payment first sends one request without the token and pays only if Zkool refuses it. The live runs of §5f paid, so this Zkool refused the probe each time. Measured directly on 2026-09-26 with `ZkoolClient.servesWithoutToken()` and the console's token:
- this Zkool, started with the key, gave `false`;
- the same Zkool restarted without `--jwt-public-key-file` gave `true`, which is what preflight turns into `zkool_unauthenticated`;
- restarted with the key again, it gave `false` (PID 62872, still running).

## 5f. regtest — a database that forgot a payment, and recipients with more than one receiver (2026-09-26, slice S5)

**The defect review S5 round 1 found.** The console matched a mined payment to its batch by address *string*. Zkool reports each output it recovers with the OVK as an Orchard-only unified address rebuilt from the note (zkool2 `memo.rs`: `UnifiedAddress::from_receivers(Some(address), None, None)`), not the address that was paid. So for a recipient whose address also holds a Sapling or transparent receiver, a mined payment never matched. The same matching drives the reconciliation after an unknown outcome. **Every version before this fix could therefore pay such a batch a second time once the attempt's expiry bound passed.** All earlier live runs used Zkool's own Ironwood-only accounts, whose address *is* the Orchard-only form, and the fake Zkool echoed the paid string, so nothing showed.

**The fix.** Payments are matched by Orchard receiver, the console's "same place" rule from H1 and H6. The fake now reports what Zkool reports.

**The live run.** `ZECEIPT_REGTEST=1 node --test test/regtest.http.e2e.test.ts` wrote `raw/tools/regtest/console-http-e2e-20260925175359.json`:
- the first recipient is a Zkool account with pools 10, whose address holds Sapling and Orchard-typecode receivers (asserted);
- the batch was paid, tx `0179c497…9e03`, confirmed at 50855;
- receipts were issued and verified;
- then the run's database was set back to "unpaid" by hand, as a backup restored from before the payment would be, and Pay was asked again through the API: 202, `replayed: true`, `via: "reconciled"`, the same txid;
- the issuer's transactions since the pre-pay height: exactly that one; the mempool: empty.

**The negative control, live.** The same run with the old string match (reverted for one run, then restored): the "restored" Pay made a **second payment**. The test failed with `f90b5285…` sent as `fresh` next to the batch's `c0dc96d5…`. That batch was paid twice on regtest, which is the defect this section records.

## 5g. regtest — the payables path: USD payables, Kraken's live rate, receipts issued by the worker on its own (2026-09-26, slice P2)

`ZECEIPT_REGTEST=1 NO_PROXY='127.0.0.1,localhost' node --test test/regtest.payables.e2e.test.ts`, run from `apps/console` against the stack of §5e. Zkool enforces tokens, and Kraken is reached through the machine's proxy (`NODE_USE_ENV_PROXY=1`). This is what §5d does not show: nobody presses Issue, and the rate is Kraken's own.

The transcript is `raw/tools/regtest/console-payables-e2e-20260925181051.json`. Two earlier runs passed the same way at Kraken's 1535.89 and 1537.01 (`…180533.json` and `…180636.json`). This third run adds the receiver and mempool assertions asked for by review P2 round 1.

| Step | What happened |
|---|---|
| Recipients | Three fresh Zkool accounts, 119–121. The first account's address holds Sapling and Orchard-typecode receivers, asserted by decoding it (`firstRecipientReceivers: ["sapling", "orchard"]`) |
| Payables | Recipients and three USD bounties made through the API: $25.00, $33.00 and $41.50, with references `PAY-<stamp>-1…3` |
| Batch | Made from the payables. The rate was locked at creation from **Kraken**: `host: api.kraken.com`, bid 1538.57, fetched 2026-09-25T18:10:53Z, rate fixed. The lines are 1624885, 2144848 and 2697309 zat, each `floor(cents × 10⁸ / (100 × rate))`. The test recomputes them, and Python `fractions` confirms them (the dropped fractions are 0.45, 0.79 and 0.84 zat, so floor and half-up differ on two of the three). The page names Kraken |
| Approve, pay | Approved at the total and lock 1. One payment, tx `57ef128c…5f0b`; a second submit replayed it |
| Receipts | The receipt worker (`ZECEIPT_AUTO_RECEIPTS_SECONDS=2`, 2 confirmations) issued all three on its own, logging `receipts: issued for batch <id>`, 10 s after the payment. The test only polls `GET /receipts`, which never issues. The batch is `receipts_issued`. The history is `created, locked, approved, quoted, attempt_submitting, attempt_broadcast, expiry_recorded, receipt_issued ×3`. The issuer's mined transactions since the pre-pay height: exactly that one, at 51039. The mempool is empty, so no second payment is waiting |
| Verified | Each receipt link through `zeceipt verify --require-signature` against the chain: VALID, with its memo and value |
| Recipients | Each account holds its exact amount, with its payable's reference as the memo |

No receipt link, OCK or wrap key appears in the transcript or the server output (asserted). The run's database is deleted afterwards.

## 6. testnet — placeholder

To be recorded once the faucet claim in §4 is made: txid, receipt URL, `verify --testnet` output and one tampered copy at exit 1.
