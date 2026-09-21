# Zeceipt — private outside, provable per payment

Verifiable receipts for shielded Zcash payments on the live **Ironwood** pool.
An organisation that pays in shielded ZEC can hand each recipient, auditor or public ledger a receipt that anyone verifies against the chain — recovering exactly one output's recipient, amount and memo — **without giving away a viewing key** and without revealing any other payment.

- Live demo / proof: [`docs/PROOF.md`](docs/PROOF.md) · Format: [`spec/receipt-v0.md`](spec/receipt-v0.md) · Prior art: [`docs/PRIOR_ART.md`](docs/PRIOR_ART.md) · Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- Built for Colosseum Crypto World's Fair 2026, Zcash track. Repository created 2026-09-21 (see [`docs/PRE_EVENT_STATE.md`](docs/PRE_EVENT_STATE.md)). MIT.

## What it is

Zcash's shielded pools already publish, for every output, an `out_ciphertext` encrypted under a per-output **Outgoing Cipher Key** derived from the sender's outgoing viewing key. Disclosing that one key lets a verifier recover that one output and nothing else. This is the `outputs` half of [ZIP 311](https://zips.z.cash/zip-0311); Zeceipt implements it for the v6/Ironwood pool (plus Orchard and Sapling), wraps it in a signed, challenge-bindable envelope, and ships an issuer/verifier CLI, a browser verifier (WASM) and a Rust/npm SDK.

It is **not** a full ZIP 311 disclosure: ZIP 311 also requires a spend-authority signature, which needs the spending key. Zeceipt never touches spending keys; issuer attribution is an application-layer ed25519 signature.

## Quick start

```bash
cargo build --release                                  # needs protoc for the gRPC client
Z=target/release/zeceipt

$Z inspect --txid <txid>                               # list shielded outputs (fetches from zec.rocks)
$Z keygen --out issuer.key                             # issuer signing key
$Z issue --ufvk uview1… --txid <txid> --label "INV-42 | 150.00 USD" --key-file issuer.key --out-dir receipts
$Z verify receipts/<file>.json                         # exit 0 valid, 1 invalid, 2 pending, 3 usage
$Z pack --title "Q3 bounties" receipts/*.json > pack.json && $Z verify-pack pack.json
```

Offline (no network): add `--raw-tx-file tx.hex`. Try it now on the committed synthetic fixture:

```bash
cargo run -q -p zeceipt-core --features synthetic --example make_synthetic
$Z issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk "$(cat fixtures/synthetic-ovk.hex)" --label demo --key-file issuer.key --out-dir /tmp/r
$Z verify /tmp/r/*.json --raw-tx-file fixtures/synthetic-ironwood.hex --require-signature
```

Browser: `cd packages/verify && npm run build:wasm && npm run demo` then open `http://localhost:8787/demo/`.

## Crates

| crate | role |
|---|---|
| `zeceipt-types` | envelope v0, canonical signing bytes, ed25519, URL form (no Zcash deps) |
| `zeceipt-core` | v4/v5/v6 parsing, OCK derivation, per-output recovery for Ironwood / Orchard / Sapling, issue & verify |
| `zeceipt-lwd` | lightwalletd/Zaino gRPC client (`GetTransaction`, `GetLatestBlock`, `GetBlockRange` scan) |
| `zeceipt-cli` | `zeceipt` binary |
| `zeceipt-wasm` | browser verifier; published as `@zeceipt/verify` |

All cryptography comes from `orchard 0.15.5`, `sapling-crypto 0.7`, `zcash_note_encryption 0.4`, `zcash_primitives 0.30.1`, `zcash_keys 0.16.1`. Nothing is re-implemented.

## What a receipt proves / does not prove

Proves: the named transaction pays the shown value to the shown recipient with the shown memo, and the issuer knew that output's OCK (i.e. held the sender's outgoing viewing key). If signed: the holder of the issuer key produced it.
Does not prove: who is presenting it (use a challenge for interactive proofs), anything about other outputs/transactions/balances, or spend authority.

## Integrations

- **Konclave / ZBooks / any payout tool**: call `zeceipt_core::issue` (or the CLI) after broadcast; attach the receipt URL to each payslip row.
- **OpenZcash / public ledgers**: publish `receipts.json`; rows become independently verifiable.
- **Auditors**: receive an audit pack instead of a viewing key; `verify-pack` reports a lower-bound total.

## Status

Working: envelope, Ironwood/Orchard/Sapling recovery, CLI, gRPC client, offline end-to-end with tamper tests, CI. In progress: WASM package build, payout console, Solana attestation program, testnet proof with real funds. See `docs/PROOF.md` §4.
