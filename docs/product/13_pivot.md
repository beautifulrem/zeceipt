# The 2026-09-30 pivot: source-of-funds dossiers

## Decision

On 2026-09-30 the product changes direction. It moves from **per-payment receipts** plus a payout console to **source-of-funds evidence for shielded ZEC**: a holder builds a dossier of claims about specific funds, and a reviewer checks every claim against the chain, with no viewing key and no deshield `[R137]`. The receipt, delivery-proof and console work stays as building blocks: a deposit claim carries a receipt, and every claim opens notes with `zdp:1:`.

## Why

- **Crowding.**
  - Per-output receipts: ZCG application #437 uses the same OCK primitive; also Glasspane, zcash-delivery-proof, ZecBooks, ZechLedger.
  - Payout consoles with audit export: Corridor, Quorum.
  - Agent payments and x402: CipherPay and at least eight more.
- **The judges read the old product as narrow** (judge rounds 1–3): a non-profit first market and zero traction.
- **The unmet, evidenced need** (`[R137]`): exchanges and bridges ask shielded holders for the source of funds and for proof of wallet control.
  - Kraken's EDD questions.
  - Binance's refusal and TEX-only deposits.
  - NEAR Intents holding $589k for 67+ days.

  The answers today are to deshield or to hand over the viewing key. Shielded-address signing is on the ZecDev wishlist, with no Ironwood standard.
- **Winners' patterns** (`[R137]`):
  - privacy that is the business itself;
  - a compliance sentence;
  - one vertical with its own documents;
  - a checkable number.

## Personas

- **Holder:** a shielded ZEC holder facing EDD, a held deposit, an OTC trade or a loan. Job: "show where these funds came from and that they are mine, and nothing else".
- **Reviewer:** a compliance analyst at an exchange, OTC desk, bridge or lender. Job: "decide on this deposit with evidence I can check and file".

## What is built (WBS 3.3.7)

| Surface | State |
|---|---|
| Format and checks: origin, path, deposit, control; `nk` nullifiers; the report | Done (3.3.7.1) |
| Builder, compact-block scanner, CLI `dossier build|scan|verify|nonce` | Done (3.3.7.2) |
| WebAssembly and `@zeceipt/verify` (`checkDossier`, `buildDossier`) | Done (3.3.7.3) |
| Case review page, dossier builder page, landing page | In progress (3.3.7.4) |
| `spec/dossier-v1.md`, PROOF §8, threat model, prior art | In progress (3.3.7.5) |
| A real testnet dossier with a control challenge | Done (3.3.7.6) |

## Scope decisions

- **No "unspent at height H" claim.** Without a zero-knowledge proof nothing binds `nk` to the owner until a nullifier is on chain. A wrong `nk`, or someone else's note known to its sender, would read as unspent forever. Current funds are proved by spending them in the control challenge.
- **Orchard-family notes only** (Ironwood, Orchard). Sapling-funded origins are reported from the transaction, and are not opened.
- **Sapling notes are not dossier subjects.** A Sapling nullifier is derived from `nk` *and the note's position* in the Sapling commitment tree, which a verifier would have to take from chain state (the tree at the note's block), where an Orchard-family nullifier needs only `nk` and the note. The work is possible, but large, and Sapling holdings are a shrinking share. So a holder with Sapling funds moves them to Ironwood first (a wallet's shielding or migration send), and builds the dossier from there: that transaction is the dossier's origin, and its funding shows the Sapling spends it consumed (counted, not valued); every later hop is linked by `path` claims as usual. What is lost is the history before the move, as with any origin (appraisal round 1, D28; stated in the README's Status and the wallet drafts).
- **The cross-chain leg** (NEAR Intents destination txids) is a stretch goal, not in v1.
- **Transparent cash-outs** (being added 2026-09-30): a `transparent_payment` claim for a payment from disclosed notes to a transparent address, an exchange's deposit or a TEX address, which is how most real cash-outs leave the pool (appraisal round 1, D03).

## NU7 (appraisal round 1, D18)

NU7 activates on testnet on **2026-10-06** and on mainnet on **2026-11-05** (RSK-14, RSK-14b). The released Zcash crates do not know its consensus branch, so every build of zeceipt (CLI, service, WebAssembly pages) refuses a transaction made after activation, by name, until a `zcash_protocol` release carries NU7: the builder cannot build over one, and a verifier fails each claim that rests on one. Dossiers whose transactions were all mined before activation keep verifying, because each transaction's branch is read from its own header. Judging runs until 2026-12-05, so the plan is:
1. **Before 10-06:** every testnet transaction the demos need is mined (the samples of PROOF §8 are; a new exchange-like chain, D15, and the technical demo's live challenge must be too, or the demo falls back to the recorded challenge, `docs/outreach/tech-demo-video.md`).
2. **10-06:** re-check the live samples after testnet activation (`docs/RELEASING.md` §6).
3. **When a `zcash_protocol` release with NU7 lands:** bump the crates, apply the spiked API changes, flip the refusal tests, rebuild the WASM and release 0.2.x (`docs/RELEASING.md` §1; spiked on librustzcash main, RSK-14). Target: before 11-05, so no judge meets a refused mainnet transaction.
4. **If no release lands by 10-20** (the mainnet height's assignment): the README's Status says that new mainnet transactions need the next release, and the pitch does not claim NU7 support.

Checked (appraisal D33, [R139]): NU7's deployment ZIP 259 does not include ZIP 231 (memo bundles), so the control challenge keeps reading its nonce from the reply note's memo. What NU7 changes for dossiers is the consensus branch and the 25-second block target (ZIP 218): after it, the same wait for a challenge covers about three times as many blocks above H₀.

## Business

- **Holders:** free and local.
- **Reviewers:** free in the browser; paid for the verification API (per verified dossier or per seat) and a self-hosted service with support. Draft prices and their reasoning: `08_gtm_pricing.md`.
- **Wedge:** the held deposit.
- **Distribution:** a wallet button ("Export source-of-funds dossier") and exchange compliance teams.
- **Risk:** no one has paid for such a tool yet (`[R137]`). The pitch names this, and asks reviewers for letters of intent.
- **ZCG's signal** (2026-09-30, `[R138]`): it declined both a standalone receipts SDK (#437, "bring it to Ironwood with support from the protocol engineers") and a ZK-TLS source-of-wealth proposal (#426) the same day. A dossier answers the first by building on ZIP 311 (the zips#387 report, drafted), and the second by claiming no standard, only evidence a reviewer can check.
