# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is 0.x, anything may change at any time (SemVer item 4).

Version links will be added once the repository has a public URL.

## [Unreleased]

The first release. This section becomes `0.1.0` when the tag is cut.

### Added

- **Receipt format v0** (`spec/receipt-v0.md`). A receipt is an optionally signed envelope that discloses one shielded output by its Outgoing Cipher Key, so that anyone can recover exactly that output's recipient, amount and memo from the chain without a viewing key. It is the `outputs` half of ZIP 311, without the spend-authority proof, which needs the spending key, and without ZIP 311's requirements that only a sender can create a disclosure and that it cannot be re-signed (`docs/outreach/zips-387-comment.md`).
  - Canonical signing bytes with an ed25519 issuer signature.
  - Challenges, for receipts made out to one verifier.
  - Audit packs, whose total is a lower bound; each output is counted once, so a receipt listed twice cannot inflate it.
  - An optional binding of an issuer key to a domain: `/.well-known/zeceipt.json`, which can only confirm a claim, never change a verdict.
  - Receipt links that carry the receipt in the URL fragment.
  - Committed test vectors: `spec/test-vectors/receipt-v0.json`.
- **`zeceipt-core`.** Parsing of v4, v5 and v6 transactions. It recovers each output's recipient, amount and memo for Ironwood, Orchard and Sapling from the OCK, using the upstream Zcash crates and re-implementing no cryptography. It issues receipts from a UFVK or a bare OVK, and verifies them.
  - Evidence: the official Orchard note-encryption vectors, round trips and tamper cases (`docs/PROOF.md` §2, §3), and a seeded mutation test that finds no panic: every committed transaction through parse, issue and verify (50,000 inputs in its deep run), and receipts, audit packs and well-known files through parsing, the signature and verification (250,000).
  - A v5 or v6 transaction whose own consensus branch its version is not valid in (such as v6 under NU6.1) is refused as malformed, as Zebra has refused it since 6.4.2 (GHSA-h5rr-8pqv-grp9); a transaction under a branch the crates do not know is refused by name. A recovered note value above MAX_MONEY is refused at recovery, when issuing and when verifying, instead of being reported valid.
- **`zeceipt-lwd`.** A lightwalletd and Zaino gRPC client: `GetTransaction`, `GetLatestBlock`, and a `GetBlockRange` scan. It was checked against `zec.rocks` on mainnet (§1).
- **`zeceipt` CLI.**
  - Subcommands: `keygen`, `inspect`, `issue`, `verify`, `pack`, `verify-pack`, `well-known` and `find-ironwood`.
  - Exit codes: 0 valid, 1 invalid, 2 pending, 3 usage.
  - Offline use with `--raw-tx-file`.
  - `--host` for receipt links, with no default host.
  - `verify --check-issuer` for the domain binding: HTTPS only, no redirects, public addresses only, and at most 64 KiB (§2d).
- **The browser verifier and the receipt page.**
  - `zeceipt-wasm` is packaged as `@zeceipt/verify` in `packages/verify`, with the built WASM committed.
  - `fetchChainTip` and `confirmations` in `@zeceipt/verify`: the chain tip over gRPC-web, and a transaction's depth (`tip − height + 1`).
  - Each gRPC-web endpoint gets 20 s (`timeoutMs`) before the next is tried, so a hanging node cannot block failover.
  - `zeceipt verify` reports `confirmations` beside `height` when it asked a node (null when the node gives no usable tip; no field for a transaction from a file).
  - The receipt page shows how many confirmations a fetched, mined transaction has, from the same node's chain tip, next to ZIP 315's recommendation of 10 for funds from an untrusted sender; without a usable tip it says the depth is unknown and the verdict is unchanged.
  - The receipt page at `/r/` verifies a receipt link in the browser, against the transaction fetched from a public node when you ask, or loaded from a file, and says where the transaction is on chain.
  - Two default gRPC-web endpoints per network, mainnet and testnet, all backed by zec.rocks (ChainSafe's are proxies to it); the page names the node it asks and says that any service behind it learns the txid.
  - The page checks the issuer's domain only when asked, stores nothing, and sends nothing outside its own site unless you ask (§2b, §2c, §2e).
- **The payout console** (`apps/console`). A self-hosted Next.js and SQLite app for a treasurer who pays contributors in shielded ZEC. Its `npm start` and `npm run dev` scripts bind it to 127.0.0.1.
  - **Setup:** recipients with checked unified addresses, and payables in US dollars.
  - **Imports:** a Konclave payroll CSV fills the new-batch form for review. A zecpay CSV becomes payables after a preview, all rows or none (`docs/product/05_data_model_api.md` §3.6).
  - **Batches:**
    - made by hand, with lines in ZEC and a ZEC/USD rate lock from Kraken that can be re-locked until the batch is submitted, or from payables, with US dollars converted at a Kraken rate fixed for the batch, each line floored to the zatoshi;
    - approved by an HMAC over the lines, rate and paying account;
    - paid in one Ironwood transaction per batch through Zkool, with a token scoped to the console's account and the rate re-checked before paying; an uncertain attempt is paid again only when nothing was mined past its expiry bound (the cases that remain are RSK-21 in `docs/product/06_risk_register.md`);
    - voided while they cannot have been paid, freeing their payables.
  - **Receipts:**
    - one per payment, issued by a worker once the payment has the configured confirmations;
    - sealed at rest;
    - exported per batch as the CSV OpenZcash writes, plus the txid, receipt link and rate.
  - **Records:** an append-only history of every batch, recipient and payable, and a warning before paying an address an earlier receipt disclosed.
  - **API:** described in `docs/api/openapi.json`, with `application/problem+json` errors.
  - **Live runs:** on a local regtest chain (§5c–§5g). These cover a batch driven through the pages without JavaScript, the payables path at Kraken's live rate, and a restored database that adopts a mined payment instead of paying again.
- **Security.**
  - `docs/THREAT_MODEL.md`.
  - `scripts/security_review.sh`, which runs `cargo audit`, `npm audit`, gitleaks over the history and the tree, and the source guards (`docs/SECURITY_REVIEW.md`).
  - Security controls for the console:
    - loopback `Host`s only, with no cross-site writes;
    - pages that cannot be framed, and that run only nonced scripts;
    - a refusal to pay through a Zkool that serves requests without a token.

Not in this release:
- receipts on a public chain (the testnet run waits on faucet funds; `docs/PROOF.md` §4);
- `@zeceipt/verify` on npm (it is packaged, not published);
- sign-in for the console;
- transactions made after NU7 activates: its consensus branch (`0x77190AD9`, ZIP 259) isn't known to the Zcash crates this release is built on, and such a transaction is refused with an error naming NU7;
- the spend-authority proof of full ZIP 311.
