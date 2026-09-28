# Zeceipt — private outside, provable per payment

Verifiable receipts for shielded Zcash payments on the live **Ironwood** pool.
An organisation that pays in shielded ZEC can hand each recipient, auditor or public ledger a receipt that anyone verifies against the chain — recovering exactly one output's recipient, amount and memo — **without giving away a viewing key** and without revealing any other payment.

- Live demo / proof: [`docs/PROOF.md`](docs/PROOF.md) (mainnet-read, synthetic, browser, regtest chain-write, and a Zkool-built 3-recipient batch in §5b) · Format: [`spec/receipt-v0.md`](spec/receipt-v0.md) · Prior art: [`docs/PRIOR_ART.md`](docs/PRIOR_ART.md) · Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) · Changes: [`CHANGELOG.md`](CHANGELOG.md) · Releasing: [`docs/RELEASING.md`](docs/RELEASING.md)
- Built for Colosseum Crypto World's Fair 2026, Zcash track. Repository created 2026-09-21 PT — commits are timestamped +08:00, so `git log` shows the first commit as 2026-09-22 00:07 (see [`docs/PRE_EVENT_STATE.md`](docs/PRE_EVENT_STATE.md)). MIT.

## What it is

Zcash's shielded pools already publish, for every output, an `out_ciphertext` encrypted under a per-output **Outgoing Cipher Key** derived from the sender's outgoing viewing key. Disclosing that one key lets a verifier recover that one output and nothing else. This is the `outputs` half of [ZIP 311](https://zips.z.cash/zip-0311); Zeceipt implements it for the v6/Ironwood pool (plus Orchard and Sapling), wraps it in a signed, challenge-bindable envelope, and ships an issuer/verifier CLI, the Rust library behind it, a browser verifier (WASM; packaged for npm as `@zeceipt/verify`, not yet published), and a self-hosted **payout console** that pays a batch of contributors in one shielded transaction and issues a receipt per payment.

It is **not** a full ZIP 311 disclosure: ZIP 311 also requires a spend-authority signature, which needs the spending key. Zeceipt never touches spending keys; issuer attribution is an application-layer ed25519 signature. For the same reason it does not meet two of ZIP 311's other requirements: that only a sender of the transaction can create a disclosure (anyone with the sender's viewing key, or an earlier receipt, can), and that disclosures are non-malleable (a receipt holder can re-sign one with their own key, which attributes it to that key only). `docs/outreach/zips-387-comment.md` sets out the trade.

## For judges

**About ten minutes on a recent laptop.** You need Rust with `protoc`, Node 24 or later, and Python 3 (for the demo server). The first run downloads crates and npm packages; after that nothing needs the network, and no wallet keys are involved.

```bash
cargo test --workspace --features zeceipt-core/synthetic   # 59 tests, including the official Orchard note-encryption vectors
node packages/verify/test/verify.mjs                       # the committed browser verifier (WASM) against the committed vectors
(cd apps/console && npm ci && npm test)                    # 489 console tests: 459 run, 30 are opt-in (build-and-serve, regtest)

# issue and verify a receipt offline, from the committed synthetic fixture
cargo build --release && Z=target/release/zeceipt && T=$(mktemp -d)
$Z keygen --out $T/issuer.key
$Z issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk "$(cat fixtures/synthetic-ovk.hex)" --label demo --key-file $T/issuer.key --out-dir $T/r
$Z verify $T/r/*.json --raw-tx-file fixtures/synthetic-ironwood.hex --require-signature   # issue prints two expected notes: a bare OVK issues every opened output, and no --host means no link

(cd packages/verify && npm run demo)                       # the receipt page at http://localhost:8787/r/, the paste demo at /demo/
```

**What runs where.** Everything above runs on your machine. The console's npm scripts bind it to 127.0.0.1, and it has no sign-in yet (see "Payout console", Security). The live evidence ran on a local Zcash regtest chain (zebrad, Zaino, Zkool; `docs/REGTEST_RUNBOOK.md`): `docs/PROOF.md` §5–§5g. On mainnet, transactions have been parsed and fetched only (§1, §2b); receipts on a public chain wait on funding.

**Where the evidence is.** `docs/PROOF.md` (each claim with its transcript), `spec/receipt-v0.md` (the format), `docs/THREAT_MODEL.md` and `docs/SECURITY_REVIEW.md` (what is defended, what is not).

**Built during the hackathon.** The repository started on 2026-09-21 PT (first commit `252c76e`), a week into the event, and no product code predates the event. `.trellis/` and `.claude/` also hold third-party workflow tooling installed with the Trellis tool and Claude Code; with `Cargo.lock`, that tooling is most of the first commit (`docs/PRE_EVENT_STATE.md`; prior art in `docs/PRIOR_ART.md`). The work was cut into small slices, each with a written requirement, and each was reviewed in recorded rounds by a separate AI review agent until it scored 100. The receipt core's and the research phase's rounds are in the development journal; later rounds have one file each in `docs/product/reviews/`, and each slice has a task in `.trellis/tasks/`.

**Team and AI assistance.** Stated in the submission form, in the team's own words.

**How it was prioritised.** `docs/product/11_plan.md`: what a one-person team kept and dropped, and why (§1.1), and the day-by-day schedule (§8). The research behind each decision is in `docs/product/10_research_log.md`.

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
$Z issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk "$(cat fixtures/synthetic-ovk.hex)" --label demo --key-file issuer.key --out-dir /tmp/r
$Z verify /tmp/r/*.json --raw-tx-file fixtures/synthetic-ironwood.hex --require-signature
```

Browser: `cd packages/verify && npm run build:wasm && npm run demo`, then open `http://localhost:8787/demo/` to paste a receipt.

Binding your key to your domain (spec §7): `zeceipt well-known --key-file issuer.key --key-id 2026-09@pay.example.org > zeceipt.json` writes the file to serve at `https://pay.example.org/.well-known/zeceipt.json`, over HTTPS without redirects. Receipts issued with that key id claim the domain.
- `zeceipt verify <receipt> --check-issuer` looks the claim up and reports it next to the verdict as `confirmed`, `not_listed` or `unknown`; it never changes `valid`. The lookup tells the domain that one of its receipts is being checked, so it runs only when asked. It uses HTTPS, follows no redirects, reads at most 64 KiB, gives up after 10 s, and refuses a domain that resolves to a private address.
- `--issuer-file <file>` compares with a copy already downloaded.
- The receipt page offers "Check with <domain>" after a valid result and asks the domain only on that click. It shows the same three outcomes, never changing the verdict (`docs/PROOF.md` §2e). The domain's server must send `Access-Control-Allow-Origin: *` for the page to read the file.

Receipt links: with `--host`, `zeceipt issue` prints each receipt as `https://<host>/r#<payload>`. **Use a host you control:** the page that host serves can read the link's fragment, which holds the receipt. `--host` has no default: without it the receipts are issued and written as usual, with `"url": null` and a note on stderr. The receipt is in the fragment, which browsers never send to the host (spec §2.1). The page at `/r/` (`packages/verify/r/`) reads it and verifies in the browser: open `http://localhost:8787/r/#<payload>` with `npm run demo` running. It shows the payment, where the transaction is on chain (per the public node it asks when you click, or unknown for a file), and who signed. Outside its own site it makes only the requests you ask for: the transaction lookup, and the issuer check if the key id names a domain. It stores nothing (`docs/PROOF.md` §2c, §2e). Hosting it: serve `packages/verify/` as the site root, and make `/r` redirect to `/r/`. Send `Content-Security-Policy: frame-ancestors 'none'` as a response header: the page's own CSP is a `<meta>` tag, where browsers ignore `frame-ancestors`, so only the host can stop the page being framed (`docs/THREAT_MODEL.md`). Static hosts do this for a directory, and the redirect keeps the fragment (RFC 9110 §10.2.2). The page's relative paths (`page.js`, `page.css`, `../src/`, `../pkg/`) only resolve from `/r/`, so a host that serves `r/index.html` at `/r` without redirecting breaks the page. Check this on the real host.

## Payout console

`apps/console` is a self-hosted web console (Next.js, SQLite, loopback only) for a treasurer who pays contributors in shielded ZEC:

1. Record recipients (their shielded addresses, checked as unified addresses) and payables in US dollars, or import them: a zecpay CSV becomes payables after a preview, and a Konclave payroll CSV fills the new-batch form for review.
2. Make a batch from payables: the ZEC/USD rate is quoted from Kraken and fixed for the batch, and each line is its dollars at that rate, floored to the zatoshi, so the payer never overpays.
3. Approve it: the approval is bound by HMAC to the exact lines, rate and paying account, so any change needs a new one.
4. Pay: one Ironwood transaction for the whole batch through Zkool (the seed stays in the wallet; the console holds a viewing key), once per batch (see Security), with the rate re-checked before paying.
5. Receipts: one per payment, issued automatically once the payment has the configured confirmations, each a link its recipient can verify in the browser.

Each batch, recipient and payable keeps an append-only history of its changes. The console also warns before paying an address an earlier receipt disclosed.

**Security** ([`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), "The payout console"; each control has a test):
- **Local only.** Its `npm start` and `npm run dev` scripts bind 127.0.0.1; `next start` alone would listen on every interface. It answers only loopback `Host`s, with no cross-site writes. Its pages cannot be framed, and they run and load only the console's own scripts and resources (a per-response CSP nonce).
- **The wallet.** The console talks to Zkool with a token scoped to its own account. It refuses to start with an admin, foreign, read-only or expired token, or one Zkool's key did not sign, and it refuses to pay through a Zkool that answers requests without a token.
- **Payments.** One transaction per batch. After an uncertain outcome, it pays again only when nothing is mined past the attempt's expiry bound. What is left is in RSK-21 ([`docs/product/06_risk_register.md`](docs/product/06_risk_register.md)): a stall inside Zkool longer than the pay timeout followed by 40 or more blocks, or a reorg deeper than the margin. A database restored from a backup adopts a mined payment rather than paying again; one still unmined at restore time is not seen.
- **Secrets.** Receipts are sealed at rest, and wrap keys never reach a log.
- **What it does not do yet:** sign-in. Anything on the machine that can reach the port can read every batch and receipt link, and in hot custody it can pay.

`scripts/security_review.sh` runs `cargo audit`, `npm audit`, gitleaks and the source guards (results in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md)).

What the live chain shows (a local regtest chain, `docs/PROOF.md` §5c–§5g):
- **A batch made on the console's form:** its rate locked from the run's local test quote source, approved, paid once in one Ironwood transaction for two posts of the Pay form, receipts issued from the page and verified against the chain, and the audit trail read back (§5d).
- **A batch made from USD payables at Kraken's live bid:** fixed at creation, each line floored to the zatoshi, approved and paid once. The receipt worker issued all three receipts on its own, with no one pressing Issue, and each verified on chain. Each recipient's wallet holds its payable's reference as the memo (§5g).
- **A database set back to "unpaid" after a payment** adopts the mined transaction instead of paying again, including for a recipient whose address holds more than one receiver (§5f).
- **The wallet refuses the console's requests without its token** (§5e). Running it: [`apps/console/README.md`](apps/console/README.md).

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

- **Konclave / ZBooks / any payout tool**: call `zeceipt_core::issue` (or the CLI) after broadcast; attach the receipt URL to each payslip row. Or pay through the console with the file you already have: it reads a Konclave payroll CSV (`label,address,value[,memo]`, ZEC) into the new-batch form for review, and a zecpay CSV (`name,wallet,amount,currency,payout_currency`, USD) as payables, after a preview that shows each address it will pay, all rows or none (`docs/product/05_data_model_api.md` §3.6).
- **OpenZcash / public ledgers**: publish each row's receipt link, or a period's audit pack; anyone can verify the rows. The console exports a batch's receipts as the CSV OpenZcash's own "Export CSV" writes, plus txid, receipt link and rate (`GET /api/batches/{id}/exports/openzcash`, `docs/product/05_data_model_api.md` §3.1); the file discloses every listed payment, permanently.
- **Auditors**: receive an audit pack instead of a viewing key; `verify-pack` reports a lower-bound total.

## Status

Working and tested: envelope v0 with committed test vectors (`spec/test-vectors/receipt-v0.json`); Ironwood, Orchard and Sapling recovery (official Orchard note-encryption vectors from `zcash-test-vectors`, Ironwood/Orchard/Sapling round trips, tamper cases); CLI with exit codes 0/1/2/3; lightwalletd gRPC client verified live against `zec.rocks`; offline issue → verify → tamper matrix reproduced by CLI and in Chrome with the committed WASM package (`packages/verify/pkg`). A **consensus-valid regtest Ironwood transaction** (Zebra + Zaino + zcash-devtool, all from source) is issued from the sender's UFVK and verified over gRPC and offline (`docs/PROOF.md` §5; fixture and CLI test committed). CI workflow is committed but this repository has not been pushed to a remote yet, so it has not run on GitHub. Security self-review: `scripts/security_review.sh` (`cargo audit`, `npm audit`, gitleaks over the history and the tree, the source guards; results in `docs/SECURITY_REVIEW.md`).

The payout console works end to end on a local regtest chain (`docs/PROOF.md` §5c–§5g):
- batches made on the form, and batches made from USD payables at Kraken's live rate;
- each approved and paid once in one transaction;
- receipts issued from the page or by the worker on its own, and verified;
- the audit trail;
- a restored database that adopts a mined payment instead of paying it again.

Pending: receipts on a public chain (the testnet run is prepared and waits on faucet funds, `docs/PROOF.md` §4; mainnet follows), and publishing `@zeceipt/verify` to npm. Dropped for this hackathon: the Solana attestation program. Out of scope for v0: the spend-authority proof (full ZIP 311).

## Building the WASM package

`packages/verify/pkg` is committed so a clone works without a toolchain. To rebuild it, run `scripts/build_wasm.sh` (or `npm run build:wasm` in `packages/verify`). The transitive `secp256k1` C library needs a wasm-capable clang: Homebrew LLVM's by default, or set `ZECEIPT_WASM_CLANG` and `ZECEIPT_WASM_AR`.

**The build is reproducible on the same toolchain.**
- The script remaps absolute build paths:
  - rustc's `--remap-path-prefix` for the Rust code (Cargo's `trim-paths` is not stable in Cargo 1.96);
  - clang's `-ffile-prefix-map` for the C code.
- So the output is the same from any checkout, and it carries no local path. `packages/verify/test/verify.mjs` fails on a committed WASM that does.
- Measured: two builds from different checkouts and target directories were byte-identical, with this toolchain:
  - rustc 1.96.0;
  - wasm-pack 0.15.0 (with its wasm-opt, version 117);
  - wasm-bindgen 0.2.128 (`Cargo.lock`);
  - Homebrew clang 23.1.1.
- The committed WASM's sha256 is `8aa7e8b3a88bbb4c1767077d489e82f9127db4c5c01dbfb9429ec444cde9d4dc` (rebuilt in slice U2).
- To check it, run `scripts/build_wasm.sh --check`. It builds into a temporary directory and compares the result with the committed package:
  - the wasm-bindgen outputs (the JS glue, the `.d.ts` files, `package.json`) must be identical;
  - the `.wasm` is reported identical or different (`--require-identical-wasm` makes a difference fail).
- A different version of any of these tools may produce different bytes. The measurement above was made on macOS.
- CI's `wasm` job rebuilds the package on Linux with the same Rust, wasm-pack and wasm-bindgen, but the runner's clang 18. It requires the wasm-bindgen outputs to match and the Linux build to pass `verify.mjs`, and reports whether the `.wasm` bytes match (slice X3b). Its first run waits for the repository's push.
