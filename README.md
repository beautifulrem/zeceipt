# Zeceipt — private outside, provable per payment

Verifiable receipts for shielded Zcash payments on the live **Ironwood** pool.
An organisation that pays in shielded ZEC can hand each recipient, auditor or public ledger a receipt that anyone verifies against the chain — recovering exactly one output's recipient, amount and memo — **without giving away a viewing key** and without revealing any other payment.

- Live demo / proof: [`docs/PROOF.md`](docs/PROOF.md) (mainnet-read, synthetic, browser, regtest chain-write, and a Zkool-built 3-recipient batch in §5b) · Format: [`spec/receipt-v0.md`](spec/receipt-v0.md) · Prior art: [`docs/PRIOR_ART.md`](docs/PRIOR_ART.md) · Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- Built for Colosseum Crypto World's Fair 2026, Zcash track. Repository created 2026-09-21 PT — commits are timestamped +08:00, so `git log` shows the first commit as 2026-09-22 00:07 (see [`docs/PRE_EVENT_STATE.md`](docs/PRE_EVENT_STATE.md)). MIT.

## What it is

Zcash's shielded pools already publish, for every output, an `out_ciphertext` encrypted under a per-output **Outgoing Cipher Key** derived from the sender's outgoing viewing key. Disclosing that one key lets a verifier recover that one output and nothing else. This is the `outputs` half of [ZIP 311](https://zips.z.cash/zip-0311); Zeceipt implements it for the v6/Ironwood pool (plus Orchard and Sapling), wraps it in a signed, challenge-bindable envelope, and ships an issuer/verifier CLI, the Rust library behind it, a browser verifier (WASM; packaged for npm as `@zeceipt/verify`, not yet published), and a self-hosted **payout console** that pays a batch of contributors in one shielded transaction and issues a receipt per payment.

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

Browser: `cd packages/verify && npm run build:wasm && npm run demo`, then open `http://localhost:8787/demo/` to paste a receipt.

Receipt links: `zeceipt issue` prints each receipt as `https://<host>/r#<payload>` (`--host`). **Use a host you control:** the page that host serves can read the link's fragment, which holds the receipt. The default, `https://zeceipt.xyz`, is not registered yet (WBS 4.1.1.2), so pass `--host` with your own site until it is. The receipt is in the fragment, which browsers never send to the host (spec §2.1). The page at `/r/` (`packages/verify/r/`) reads it and verifies in the browser: open `http://localhost:8787/r/#<payload>` with `npm run demo` running. It shows the payment, where the transaction is on chain (per the public node you choose to ask, or unknown for a file), and who signed. It makes no other request and stores nothing (`docs/PROOF.md` §2c). Hosting it: serve `packages/verify/` as the site root, and make `/r` redirect to `/r/`. Static hosts do this for a directory, and the redirect keeps the fragment (RFC 9110 §10.2.2). The page's relative paths (`page.js`, `page.css`, `../src/`, `../pkg/`) only resolve from `/r/`, so a host that serves `r/index.html` at `/r` without redirecting breaks the page. Check this on the real host.

## Payout console

`apps/console` is a self-hosted web console (Next.js, SQLite, loopback only) for a treasurer who pays contributors in shielded ZEC:

1. Record recipients (their shielded addresses, checked as unified addresses) and payables in US dollars.
2. Make a batch from payables: the ZEC/USD rate is quoted from Kraken and fixed for the batch, and each line converts exactly.
3. Approve it: the approval is bound by HMAC to the exact lines, rate and paying account, so any change needs a new one.
4. Pay: one Ironwood transaction for the whole batch through Zkool (the seed stays in the wallet; the console holds a viewing key), never twice, with the rate re-checked before paying.
5. Receipts: one per payment, issued automatically once the payment has the configured confirmations, each a link its recipient can verify in the browser.

Each batch, recipient and payable keeps an append-only history of its changes. The console also warns before paying an address an earlier receipt disclosed.

What the live chain shows (a local regtest chain, `docs/PROOF.md` §5c, §5d): a batch made on the console's form, its rate locked (from the run's local test quote source), approved, paid once in one Ironwood transaction for two posts of the Pay form, receipts issued from the page and verified against the chain, and the audit trail read back. Batches made from USD payables, the live Kraken quote and automatic issuance are covered by the console's tests, not yet by a live run in PROOF. Running it: [`apps/console/README.md`](apps/console/README.md).

## Crates

| crate | role |
|---|---|
| `zeceipt-types` | envelope v0, canonical signing bytes, ed25519, URL form (no Zcash deps) |
| `zeceipt-core` | v4/v5/v6 parsing, OCK derivation, per-output recovery for Ironwood / Orchard / Sapling, issue & verify |
| `zeceipt-lwd` | lightwalletd/Zaino gRPC client (`GetTransaction`, `GetLatestBlock`, `GetBlockRange` scan) |
| `zeceipt-cli` | `zeceipt` binary |
| `zeceipt-wasm` | browser verifier; packaged as `@zeceipt/verify` in `packages/verify` (npm publishing pending) |

All cryptography comes from `orchard 0.15.5`, `sapling-crypto 0.7`, `zcash_note_encryption 0.4.2`, `zcash_primitives 0.30.1`, `zcash_keys 0.16.1`. Nothing is re-implemented.

## What a receipt proves / does not prove

Proves: the named transaction pays the shown value to the shown recipient with the shown memo, and whoever produced the receipt knew that output's OCK (deriving it takes the sender's outgoing viewing key, but anyone holding an earlier receipt for that output knows it too). If signed: the holder of the issuer key produced this envelope.
Does not prove: who is presenting it (use a challenge for interactive proofs), anything about other outputs/transactions/balances, or spend authority.

## Integrations

- **Konclave / ZBooks / any payout tool**: call `zeceipt_core::issue` (or the CLI) after broadcast; attach the receipt URL to each payslip row.
- **OpenZcash / public ledgers**: publish each row's receipt link, or a period's audit pack; anyone can verify the rows.
- **Auditors**: receive an audit pack instead of a viewing key; `verify-pack` reports a lower-bound total.

## Status

Working and tested: envelope v0 with committed test vectors (`spec/test-vectors/receipt-v0.json`); Ironwood, Orchard and Sapling recovery (official Orchard note-encryption vectors from `zcash-test-vectors`, Ironwood/Orchard/Sapling round trips, tamper cases); CLI with exit codes 0/1/2/3; lightwalletd gRPC client verified live against `zec.rocks`; offline issue → verify → tamper matrix reproduced by CLI and in Chrome with the committed WASM package (`packages/verify/pkg`). A **consensus-valid regtest Ironwood transaction** (Zebra + Zaino + zcash-devtool, all from source) is issued from the sender's UFVK and verified over gRPC and offline (`docs/PROOF.md` §5; fixture and CLI test committed). CI workflow is committed but this repository has not been pushed to a remote yet, so it has not run on GitHub. Security self-review: `scripts/security_review.sh` (`cargo audit`, `npm audit`, gitleaks over the history and the tree, the source guards; results in `docs/SECURITY_REVIEW.md`).

The payout console works end to end on a local regtest chain (`docs/PROOF.md` §5c, §5d): a batch locked, approved, paid once in one transaction, its receipts issued and verified, and its audit trail. Batches from USD payables, the live Kraken quote and automatic issuance are tested but not yet shown in a live run.

Pending: receipts on a public chain (the testnet run is prepared and waits on faucet funds, `docs/PROOF.md` §4; mainnet follows), and publishing `@zeceipt/verify` to npm. Dropped for this hackathon: the Solana attestation program. Out of scope for v0: the spend-authority proof (full ZIP 311).

## Building the WASM package

`packages/verify/pkg` is committed so a clone works without a toolchain. To rebuild: the transitive `secp256k1` C library needs a wasm-capable clang, e.g. on macOS with Homebrew LLVM:

```bash
export CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar \
       CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown -O2 -nostdlib -fno-exceptions -D__wasm32__"
wasm-pack build crates/zeceipt-wasm --target web --release --out-dir ../../packages/verify/pkg
```
