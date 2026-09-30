# The dossier service (`zeceipt dossier serve`)

A small HTTP/1.1 service that runs `zeceipt dossier verify` for a compliance back office: post a dossier, get the report JSON. Written 2026-09-30 from `crates/zeceipt-cli/src/main.rs` (`serve_dossiers`, `check_dossier_text`) and `crates/zeceipt-core/src/dossier.rs` (`Report`) in the working tree after `44b8877`, which adds the nonce's issue height, `assurance` and the `transparent_payment` claim (not yet committed that day), and checked against a running build of that tree the same day (the examples below are its answers). If those changes are committed differently, re-check the parts marked "(new)". The machine-readable description is [`dossier-service.openapi.json`](dossier-service.openapi.json) (OpenAPI 3.1). The test is `dossier_serve_answers_over_http` in `crates/zeceipt-cli/tests/cli.rs`.

The service holds no state, no accounts and no keys. It keeps no copy of a dossier or a report, and it logs one line at startup and nothing per request.

## Running it

```bash
cargo build --release -p zeceipt-cli
target/release/zeceipt dossier serve                                   # http://127.0.0.1:8787, public zec.rocks nodes
target/release/zeceipt dossier serve --endpoint https://your-node:443  # your own lightwalletd or Zaino
target/release/zeceipt dossier serve --raw-tx-dir /case/txs            # air-gapped: <txid>.hex files, no node
```

| Option | Default | Meaning |
|---|---|---|
| `--listen <addr:port>` | `127.0.0.1:8787` | Where to listen. A non-loopback address is refused unless `--allow-remote` is given |
| `--allow-remote` | off | Allow a non-loopback `--listen`. The service has no TLS and no authentication: put it behind your own |
| `--endpoint <url>` | zec.rocks (`zec.rocks` for mainnet, `testnet.zec.rocks` for testnet) | The node(s) to fetch transactions from; repeat for fallbacks. Required for a `regtest` dossier |
| `--raw-tx-dir <dir>` | none | Read `<txid>.hex` files instead of a node. A missing file leaves the claims that need it `not_checked`; heights are unknown, so every claim adds "Loaded without a height (from a file): the inclusion of … in the chain was not checked here" |
| `--testnet`, `--regtest` | off | For checking, not needed: each dossier's own `network` field selects the network, and `--testnet` forces testnet for every dossier, so a service started with it cannot check a mainnet dossier. They do select the network whose chain height `POST /v1/nonces` reports |

**Docker.** The repository's [`Dockerfile`](../../Dockerfile) builds the CLI and runs `zeceipt dossier serve --allow-remote --listen 0.0.0.0:8787` as an unprivileged user; extra arguments (`--endpoint …`, `--raw-tx-dir …`) are appended.

```bash
docker build -t zeceipt .
docker run --rm -p 127.0.0.1:8787:8787 zeceipt
docker run --rm -p 127.0.0.1:8787:8787 -v "$PWD/fixtures/testnet:/txs:ro" zeceipt --raw-tx-dir /txs
```

Built and run on 2026-09-30 (Docker 29.5.2 on colima, `rust:1.96-bookworm` builder, a 64 MB `distroless/cc-debian12:nonroot` image): `/healthz` answered, and the testnet sample verified 12 of 12 with `controlled` true, offline from a mounted directory and live from `testnet.zec.rocks` (17.7 s). With colima or Docker Desktop, mount a directory the VM shares (under your home directory by default); an unshared path mounts as an empty directory, and every claim is then `not_checked`.

**Before exposing it.** Front it with a reverse proxy that terminates TLS, authenticates callers, limits the request rate and sets a timeout. The service has none of these. A verification can take seconds (the testnet sample took 7–11 s against `testnet.zec.rocks` on 2026-09-30), and each connection is served in its own task with no limit. The service sends no CORS headers, so a page on another origin cannot read its answers: it is meant to be called from a server.

## Endpoints

Every answer is JSON (`content-type: application/json`, `cache-control: no-store`). Any other method or path gets `404` with `{"error": "POST /v1/dossiers/verify, POST /v1/nonces or GET /healthz"}`; there is no `405`, so `GET /v1/dossiers/verify` is a 404.

### `GET /healthz`

`200`:

```json
{"ok":true,"version":"zeceipt-dossier-v1"}
```

`version` is the dossier format this build reads.

### `POST /v1/nonces`

A fresh challenge for a holder: `zeceipt-challenge-` and 16 random bytes from the operating system's generator, in hex, with the chain height and time it was issued at (new). No request body is needed. `201`, from a service started with `--testnet`:

```json
{"issued_at":"2026-09-30T15:58:33Z","issued_at_height":4422278,"network":"test","nonce":"zeceipt-challenge-3b8f8c3d38f309ee7e8649c9a628066a"}
```

- `issued_at_height` is the tip of the service's own node, on the service's network (mainnet unless it was started with `--testnet` or `--regtest`). It is `null` when no node answers, and always `null` with `--raw-tx-dir`, where `network` is also absent.
- The service does not remember the nonce. Record the answer with the case, and pass `nonce` back as `expect_nonce` and `issued_at_height` as `issued_at_height` when the dossier arrives (spec §7.1).

### `POST /v1/dossiers/verify`

The request body is the dossier file exactly as the holder sent it (UTF-8 JSON, at most 1 MiB; the content type is not checked). `dossier_sha256` in the report is the sha256 of these bytes, for the case file.

| Query parameter | Meaning |
|---|---|
| `expect_nonce` (optional) | The nonce you issued. Every control claim must answer it, or it fails ("not the one you issued"). Without it, `controlled` is always `false`, because an old dossier answers an old nonce. With it and no control claim in the dossier, `problems` says so and `all_verified` is false. The value is taken literally: `+` becomes a space and there is no percent-decoding, which zeceipt's nonces (`[a-z0-9-]`) never need |
| `issued_at_height` (optional, new) | The chain height when you issued the nonce. A control transaction mined below it fails ("mined at height H, before you issued the nonce at height H₀"). If the challenge's height is unknown (`--raw-tx-dir`), the claim can still verify, and a detail says the height was not checked. Not a non-negative integer: `400` |

The service fetches every transaction the dossier's claims name, then the previous transactions of its origins' transparent inputs (to read the funders' addresses from the outputs they spend), from `--raw-tx-dir` or the node, and checks every claim (`spec/dossier-v1.md` §5).

```bash
curl -s -X POST --data-binary @fixtures/dossier/testnet-dossier.json \
  "http://127.0.0.1:8787/v1/dossiers/verify?expect_nonce=zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8"
```

| Status | When | Body |
|---|---|---|
| `200` | The dossier parsed and was checked, whatever the outcome | The report (below). A failed claim is still a `200` |
| `400` | The body is not UTF-8, or `issued_at_height` is not a height | `{"error": "the body is not UTF-8"}`, `{"error": "issued_at_height is a block height"}` |
| `413` | The body is over 1 MiB (1,048,576 bytes), or the upload broke off | `{"error": "the body is over 1 MiB, or broken"}` |
| `422` | The dossier does not parse: bad JSON, an unknown field or claim type, another version, a malformed note opening or `nk`, a note disclosed twice | `{"all_verified": false, "stage": "parse", "error": "…"}` |
| `502` | Fetching transactions failed with an error other than "not found" or "not mined yet" (every node unreachable, for example) | `{"error": "fetching transactions: …"}` |

A `422`, from a dossier with a field added:

```json
{"all_verified":false,"error":"json: unknown field `extra`, expected one of `version`, `network`, `created`, `subject`, `nk`, `notes`, `receipts`, `claims` at line 1 column 79","stage":"parse"}
```

A `502`, with `--endpoint http://127.0.0.1:9` (nothing listening):

```json
{"error":"fetching transactions: all endpoints failed; last error: could not connect to http://127.0.0.1:9: transport error"}
```

A transaction the node does not have, or has only in its mempool, is not an error: the claims that rest on it are `not_checked`, and the report is a `200`.

## The report (`zeceipt-dossier-report-v1`)

The same JSON `zeceipt dossier verify` prints, and `checkDossier` returns in the browser.

| Field | Type | Meaning |
|---|---|---|
| `version` | string | `"zeceipt-dossier-report-v1"` |
| `network` | `"main"` \| `"test"` \| `"regtest"` | The dossier's network |
| `nk_proven` | bool | Some disclosed note's nullifier, derived with the dossier's `nk`, is among a fetched transaction's spends: `nk` is that account's |
| `controlled` | bool | A control claim verified against `expect_nonce`. Always `false` without `expect_nonce` |
| `problems` | [string], omitted if empty | Dossier-level problems (an `nk` that is not a key, a transaction file filed under another txid); any entry makes `all_verified` false |
| `subject` | string, optional | Copied from the dossier; unauthenticated |
| `dossier_sha256` | hex | sha256 of the request body |
| `notes` | object: id → note fact | Per disclosed note: `txid`, `pool`, `action`, and when known `height`, `recipient`, `value_zat`, `memo`, `nullifier`, `spent_in` (the fetched transaction that spends it: only then is the note shown to be the holder's), or `error` |
| `claims` | [claim result] | In the dossier's order: `index`, `kind` (`origin`, `path`, `deposit`, `control`, and new: `transparent_payment`), `status`, `summary` (one sentence), `details` (omitted if empty), `funding` (origin: `transparent_inputs` of `{prevout, address?, value_zat?, paid_in_claim?}`, `shielded_actions`, `sapling_spends`, `from_disclosed`), `value_zat` (deposit and transparent payment: the amount paid; control: the spent notes), `paid_to` (new, transparent payment: the address, read from the output's script) |
| `all_verified` | bool | Every claim `verified` and no `problems` |
| `assurance` (new) | string | `verified_with_control` (every claim verified, and a control claim answers your nonce), `verified_history_only` (every claim verified, but nothing shows the holder can spend the funds now), or `not_verified` |
| `issued_at_height` (new) | integer, optional | The `issued_at_height` you passed |
| `disclosed` | [string] | What the holder gave up by handing the dossier over |
| `does_not_prove` | [string] | What no claim proves (counterparties, undisclosed inputs, undisclosed funds, funds after the challenge, a legal attestation) |

**Statuses.** `verified`; `failed` (the chain data contradicts the claim); `not_checked` (a transaction is in the mempool or was not found: check again later); `unproven` (the data given cannot show it, and waiting will not change that: an origin whose note nothing in the dossier spends, so it is not shown to be the holder's).

**Reading it as the CLI does.** `zeceipt dossier verify` exits 0 when `all_verified`; 1 when a claim is `failed` or `unproven` or there is a problem; 2 otherwise (something is `not_checked`). A reviewer who sent a nonce reads `assurance` (or `controlled`), not only `all_verified`: without `expect_nonce`, a dossier with no control claim is `all_verified` and shows no control.

**Transparent payments (new).** A dossier claim `{"type": "transparent_payment", "tx": "<txid>", "output": <n>, "funded_by": ["<note id>", …]}` says the holder paid transparent output `n` of `tx` (an exchange deposit or a TEX address) from the listed notes. The check reads the address and amount from the output's script, and requires each funding note's nullifier among the transaction's spends. When an origin's transparent input spends such an output (funds that left the pool and came back), its `paid_in_claim` names that claim. An example from a run follows the main example below.

### Example

The testnet sample, checked on 2026-09-30 against `testnet.zec.rocks` with its nonce. The report has 12 claims and 9 notes; three of each are shown (the OpenAPI file has the same excerpt):

```json
{
  "version": "zeceipt-dossier-report-v1",
  "network": "test",
  "nk_proven": true,
  "controlled": true,
  "subject": "Testnet holder, zeceipt demo (2026-10-01)",
  "dossier_sha256": "7b8d7ecfa99676a660f27c0c5cbdce03ee130d138a48b51eeb7c0d9f167ea9c1",
  "notes": {
    "n1": {
      "txid": "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b",
      "pool": "ironwood", "action": 0, "height": 4419987,
      "recipient": "utest1r939nk7ur0s77ax88gne887nllp42s8d9wuqvpt3y902my24yhzdtk296g53u569hlq6xrtzuryfuw4mfekgfpz20jv0k4hsfumv0kcu",
      "value_zat": 100000000,
      "memo": "fauzec/v1\n01M3RKDCFTR8V9DHKYW6ZM8H4X\n1790839688811\nhttps://fauzec.com/help",
      "nullifier": "335f8277b12c0d891b373070ce9452c800e977d89e359f481adbea45032c9110",
      "spent_in": "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b"
    },
    "n4": {
      "txid": "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b",
      "pool": "ironwood", "action": 3, "height": 4420000,
      "recipient": "utest1nz4f89fec5w668eqt0ulwasmv7g8wjzvaux772dm9lyjjaeeh46r8f9jsjfhnet6406h9fz2969aa858kt5ckj5kmnjh9g748v4en7fj",
      "value_zat": 24743750, "memo": "",
      "nullifier": "309a6b8661b576d6c17d02a5ae2aba25df7d2e4a2c5410fca250c05f4e203d30",
      "spent_in": "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43"
    },
    "n9": {
      "txid": "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43",
      "pool": "ironwood", "action": 1, "height": 4421345,
      "recipient": "utest1r939nk7ur0s77ax88gne887nllp42s8d9wuqvpt3y902my24yhzdtk296g53u569hlq6xrtzuryfuw4mfekgfpz20jv0k4hsfumv0kcu",
      "value_zat": 100000,
      "memo": "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8",
      "nullifier": "41165a607c7f2a79b9c2f74b46683970d448dffb51251284d075fdaa69410f1d"
    }
  },
  "claims": [
    {
      "index": 0, "kind": "origin", "status": "verified",
      "summary": "1.00000000 TAZ arrived in note n1, in 90f6a335…2a4b at height 4419987, funded from the shielded pool by an undisclosed sender.",
      "details": ["n1 was later spent with this dossier's nk (in fcfde625…7f0b), so it belonged to that account."],
      "funding": {"transparent_inputs": [], "shielded_actions": 2, "sapling_spends": 0, "from_disclosed": []}
    },
    {
      "index": 5, "kind": "deposit", "status": "verified",
      "summary": "The holder paid 0.01000000 TAZ to utest19qmzk8etf7n9hhr3p7ela3yvd99y0803hlgswgjwsdzmn7pfxskwnax49szfd8uldj2lzewps2nscjwjuam22jpdwgwjg7h9qurwd44u (memo \"INV-T-001\") in fcfde625…7f0b at height 4420000, from n1 (1.00000000 TAZ disclosed).",
      "value_zat": 1000000
    },
    {
      "index": 11, "kind": "control", "status": "verified",
      "summary": "Answering nonce zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8, the holder spent n4 (0.24743750 TAZ) in 10e941e7…6e43 at height 4421345: they could spend these funds after the nonce was issued.",
      "value_zat": 24743750
    }
  ],
  "all_verified": true,
  "disclosed": [
    "9 note openings (each: its transaction, amount, recipient address and memo)",
    "nk, the nullifier key: the reviewer can tell when any disclosed note is spent, and so can anyone who learns nk and another of the account's note openings (its sender knows them)",
    "3 sender receipts (each opens one payment the holder made)"
  ],
  "does_not_prove": [
    "who the counterparties are: an origin shows the transparent addresses that funded a transaction, not who holds them",
    "the value of undisclosed inputs of a transaction: they are counted, not valued",
    "anything about notes, payments or balances the dossier does not disclose",
    "that funds are unspent now: control shows the holder could spend the listed notes when the challenge transaction was made",
    "a legal attestation: this is evidence a reviewer weighs, not a certificate"
  ]
}
```

The report of the working tree also carries `"assurance": "verified_with_control"` (new). The same request with `expect_nonce=zeceipt-challenge-00000000000000000000000000000000` is also a `200`, with `all_verified` and `controlled` false, and claim 11 `failed`: "This control claim answers nonce zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8, not the one you issued: it was made for another challenge, or an earlier one." With the right nonce and `issued_at_height=4421400`, above the challenge's height 4,421,345, claim 11 fails: "The challenge transaction 10e941e7…6e43 was mined at height 4421345, before you issued the nonce at height 4421400: it was not made in answer to your challenge." Without `expect_nonce`, `all_verified` is true, `controlled` false and `assurance` `verified_history_only`.

A transparent payment and an `unproven` origin (new), from `fixtures/dossier/testnet-dossier-transparent-origin.json` as regenerated in the working tree on 2026-09-30, checked offline (`--raw-tx-dir fixtures/testnet`). The holder paid 0.05 TAZ from n5 to a transparent address, then shielded it back; the origin of the shielded note names that payment. The address is the holder's own, not an exchange's:

```json
{
  "index": 12,
  "kind": "transparent_payment",
  "status": "verified",
  "summary": "The holder paid 0.05000000 TAZ to tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu (transparent output 0) in 52af3e0d…105e, from n5 (0.24743750 TAZ disclosed).",
  "details": [
    "The address and amount are read from the output's script on chain; the funding notes' nullifiers in that transaction tie the payment to the holder.",
    "Loaded without a height (from a file): the inclusion of 52af3e0d…105e, fcfde625…7f0b in the chain was not checked here."
  ],
  "value_zat": 5000000,
  "paid_to": "tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu"
}
```

```json
{
  "index": 13,
  "kind": "origin",
  "status": "unproven",
  "summary": "0.04985000 TAZ arrived in note n10, in c28b6000…cefe, funded by 1 transparent input worth 0.05000000 TAZ from tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu, which the holder paid there from disclosed notes (transparent payment 52af3e0d…105e:0).",
  "details": [
    "Nothing here shows n10 is the holder's: its nullifier is in no supplied transaction, and the sender of a note knows its opening too. A path, deposit or control claim that spends it would show it.",
    "Loaded without a height (from a file): the inclusion of c28b6000…cefe in the chain was not checked here."
  ],
  "funding": {
    "transparent_inputs": [
      {
        "prevout": "52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e:0",
        "address": "tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu",
        "value_zat": 5000000,
        "paid_in_claim": 12
      }
    ],
    "shielded_actions": 2,
    "sapling_spends": 0,
    "from_disclosed": []
  }
}
```

Summary and detail sentences are for people, and their wording may change between versions; a program reads `status`, `kind`, `value_zat`, `funding` and the note facts.

## Privacy and trust

- **The node** learns which transactions were asked for together, which links them (spec §8.4). Use `--endpoint` with your own node, or `--raw-tx-dir`.
- **The node is trusted** for inclusion and heights: a txid binds a transaction's contents, not that it was mined. In `--raw-tx-dir` mode nothing is checked about inclusion, and every claim says so.
- **The request and the report are case material.** A dossier discloses note openings and the holder's `nk`, and the report lists the disclosed notes' nullifiers: anyone holding either can recognise those notes' later spends (spec §8.1). Keep them to the case, and do not log request bodies in the proxy in front of the service.
