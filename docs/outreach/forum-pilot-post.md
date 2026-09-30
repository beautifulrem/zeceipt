<!--
DRAFT, not posted. Posting is the owner's decision: a public post on forum.zcashcommunity.com (WBS 4.1.2.2).
Rewritten 2026-09-30 for the pivot to source-of-funds dossiers (appraisal round 1, D21); the receipts-era call ("looking for one pilot") is in git history.
Target post date 10-01 (`docs/product/08_gtm_pricing.md` §2). Suggested category: Ecosystem / Applications. Suggested title below.
Before posting: open the sample link and check it shows "All 12 claims verified" (the Pages deploy lags a push by about 6 minutes, RELEASING §6);
if NU7 has activated on testnet (10-06) re-check it first. If a mainnet dossier or a reviewer's statement exists by then, add it to "What works today".
The transparent_payment claim was in the working tree on 09-30 (not committed): once it is committed and live on the pages, move "Transparent cash-outs" from
"What does not exist yet" to the claims table ("Transparent payment: the holder paid this transparent address this amount, from these notes").
Every sentence is backed by `docs/PROOF.md` §8, the tests, `docs/api/dossier-service.md` and `docs/product/10_research_log.md` (R137, R138).
Do not name timtech, Kraken's customer or any other holder as a pilot without their consent; the links to public threads are fine.
-->

# Source-of-funds evidence for shielded ZEC, without a viewing key: looking for reviewers to try it

If you hold shielded ZEC, you may already have had the letter: an exchange asks for "the specific source of each recent Zcash deposit" and whether your wallets are "solely owned and controlled by you" ([/t/55347](https://forum.zcashcommunity.com/t/55347)). One holder has had $589k held at NEAR Intents for more than 67 days, and has answered with screenshots and hashes, because there is nothing better to send ([/t/57497](https://forum.zcashcommunity.com/t/57497)). Today the answers are to deshield, or to hand over a viewing key that opens every past and future payment.

**Zeceipt** is a third answer: a **dossier**. The holder builds it from their own wallet, and the reviewer checks every claim in it against the chain, in a browser or on their own server. It discloses the notes the case is about, the payments made from them, and the account's nullifier key `nk`, which derives nullifiers and nothing else. It never contains a viewing key.

**Try it in two minutes:** [a real testnet dossier, checked claim by claim in your browser](https://beautifulremi.dpdns.org/zeceipt/case/#sample). Then change one character of its nonce, or one byte of `nk`, and check it again.

## What a dossier proves

| Claim | What the reviewer learns |
|---|---|
| **Origin** | These funds arrived in this note, in this transaction, and how that transaction was funded: the transparent addresses behind its inputs (read from the outputs they spend), or a shielded sender |
| **Path** | The funds moved on: this note was spent in the transaction that created that one (found by the note's nullifier, derived from `nk`) |
| **Deposit** | The holder made this payment (recipient, amount, memo) from these notes |
| **Control** | After *you* sent a nonce, someone with spend authority over these notes spent them in a transaction whose memo carries it. A viewing key cannot do that |

Each claim comes back `verified`, `failed`, `not_checked` (a transaction not mined or not found yet) or `unproven` (the data cannot show it, and the report says why).

## What it does not prove

Every report lists these, and so do I:
- **who the counterparties are**: an origin names the transparent addresses that funded a transaction, not who holds them;
- **what happened before the first disclosed origin**, or the value of inputs the dossier does not disclose;
- **that the funds are unspent now**: control shows spend authority when the challenge transaction was made. There is deliberately no "unspent at height H" claim (the spec's §4 explains why);
- **who is presenting it**: a holder could relay your nonce to whoever controls the funds. A deposit to the address you assigned this customer is the strongest cross-check;
- **anything legal**: it is evidence you weigh, not a certificate, and no regulator or exchange has endorsed it.

What it costs the holder: disclosure is permanent, and `nk` lets whoever holds the dossier see when the disclosed notes are later spent. Every report lists what was disclosed, and the spec (§8) recommends moving the remaining funds to a new account after the case.

## What works today

- **A real testnet dossier**: a faucet origin, four hops, three payments and a control challenge answered on chain at height 4,421,345. All 12 claims verify live and offline; wrong keys, wrong nonces, foreign notes and payments not funded by the listed notes fail ([`docs/PROOF.md`](https://github.com/beautifulrem/zeceipt/blob/master/docs/PROOF.md) §8). A second one names a transparent funder of its origin, read from the previous transaction's output.
- **For reviewers**: the [case review page](https://beautifulremi.dpdns.org/zeceipt/case/) (checks in WebAssembly, prints a case report with the dossier's sha256, generates nonces), `zeceipt dossier verify` on the command line, and `zeceipt dossier serve`, an HTTP service for a back office, self-hosted, with a Dockerfile, that can run against your own node or with no network at all ([API](https://github.com/beautifulrem/zeceipt/blob/master/docs/api/dossier-service.md)).
- **For holders**: the [build page](https://beautifulremi.dpdns.org/zeceipt/build/) finds your transactions by scanning compact blocks in the page, and your viewing key never leaves it; or `zeceipt dossier build` from a key file.

## What does not exist yet

- **A mainnet dossier.** Everything above is testnet. Mainnet needs funds, and a real case.
- **Transparent cash-outs.** Most cash-outs leave the shielded pool to a transparent deposit or TEX address. A claim for that payment is being added now.
- **Sapling funds** cannot be the subject of a claim (a Sapling nullifier needs the note's position as well as `nk`): move them to Ironwood first, and the dossier starts there.
- **NU7**: from its activation (testnet 10-06, mainnet 11-05), transactions made after it are refused, by name, until the Zcash crates release NU7 support. Dossiers over earlier transactions keep verifying.
- **Anyone who has accepted one.** That is why I'm posting.

## The pilot I'm looking for

Reviewers, not payers:
- **compliance teams** at exchanges or bridges that receive shielded ZEC and send EDD requests;
- **OTC desks** that need a source-of-funds file per counterparty;
- **lawyers and advisers** helping a holder with a held or frozen deposit.

The ask: check one dossier, the sample or a real one from a holder you are working with, and tell me whether it would change your decision, and what is missing. About 30 minutes. If it helps, I will walk a holder through building one, on any network, without seeing their key. With your consent, your answer (even "no, because…") can be quoted in our Crypto World's Fair submission (deadline 10-12); later answers are just as welcome.

If you are a holder in a held-deposit case: you can build a dossier yourself today on testnet to see what it discloses, and I'd like to hear what your reviewer asked for.

## Questions for everyone

- Reviewers: what would you need to see before accepting this in place of screenshots or a viewing key?
- Would you rather check in the browser, with the CLI, or through an API?
- Holders: which wallet should have an "Export source-of-funds dossier" button first?

Code, spec and proof log: https://github.com/beautifulrem/zeceipt (start with the [README](https://github.com/beautifulrem/zeceipt/blob/master/README.md); the format is [`spec/dossier-v1.md`](https://github.com/beautifulrem/zeceipt/blob/master/spec/dossier-v1.md)). Open source, Apache-2.0. Built for Colosseum's Crypto World's Fair, Zcash track.
