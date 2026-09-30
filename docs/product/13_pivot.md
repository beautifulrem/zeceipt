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
- **The cross-chain leg** (NEAR Intents destination txids) is a stretch goal, not in v1.

## Business

- **Holders:** free and local.
- **Reviewers:** free in the browser; paid for the verification API, case exports and a hosted node endpoint.
- **Wedge:** the held deposit.
- **Distribution:** a wallet button ("Export source-of-funds dossier") and exchange compliance teams.
- **Risk:** no one has paid for such a tool yet (`[R137]`). The pitch names this, and asks reviewers for letters of intent.
