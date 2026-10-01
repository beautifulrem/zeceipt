<!--
DRAFT, not posted (WBS 3.3.3.4, REQ-INT-4; appraisal round 1, D19). Posting is the owner's decision: a public comment on
https://github.com/zcash/zips/issues/387 (ZIP 311, Zcash Payment Disclosures). A shorter version could also go in the #437 forum thread (/t/57729).
Rewritten 2026-09-30 for the pivot: the receipts-era report ("the outputs half of ZIP 311") is in git history, and its questions 1–3 are folded in below.
Sources: hanh's #437 decision, forum /t/57729/4, read 2026-09-30 (R138); ZCG #437 closed "Grant Declined" 2026-09-30 13:25 UTC (R138); ZCG's 09-28
meeting minutes, forum /t/57928 (posted 2026-09-30 13:11 UTC, quoted in appraisal round 2 §1.1); zally's ZallyIronwood profile, read with `gh api` at
4eaa0bb on 2026-10-01 (R140; `docs/PRIOR_ART.md`).
Every technical sentence is backed by `spec/dossier-v1.md` (§3 nullifiers from nk, §4 no unspent claim, §7 control), `docs/PROOF.md` §8 and the tests.
Before posting: if spec/dossier-v1.md's section numbers have moved, fix the § references; if a mainnet dossier, a wallet maintainer's reply or a
reviewer's statement exists, add it to "Evidence" and to the answers to the committee's concerns; check that @gustavovalverde is the handle to mention.
-->

**An implementation report: ZIP 311 output disclosures on Ironwood, extended with note openings, nullifier paths and a control challenge**

On 2026-09-30 ZCG declined a standalone receipts SDK (#437) with this note from hanh ([forum /t/57729/4](https://forum.zcashcommunity.com/t/57729/4)):

> The committee believes a standalone implementation will not deliver sufficient value to the community, but agrees that payment receipts are useful. We refer you to ZIP 311: Zcash Payment Disclosures and would encourage you to bring it to Ironwood with support from the protocol engineers.

We built on the same primitive and took the same advice, so here is what we have, how it maps to ZIP 311, and where we need the protocol engineers' judgement. Zeceipt ([github.com/beautifulrem/zeceipt](https://github.com/beautifulrem/zeceipt), Apache-2.0) implements ZIP 311's output disclosures for Ironwood (and Orchard and Sapling), and uses them in a **source-of-funds dossier** ([`spec/dossier-v1.md`](https://github.com/beautifulrem/zeceipt/blob/master/spec/dossier-v1.md)): what a holder of shielded ZEC hands an exchange or OTC desk that asks where the funds came from, instead of a viewing key or a deshield.

**Where ZIP 311 stands, and what this fills**

The draft text merged in #426 (2024-07-17) defines payment disclosures for Sapling only, and lists its open items itself: "TODO: Add support for Orchard", "Decide on payment disclosure versioning", "Define encodings for unsigned and signed payment disclosures", BIP 322 inputs, and "how UIs should display payment disclosures". Against that list:
- **Orchard-family outputs, including Ironwood:** implemented. An output is disclosed by its `ock` exactly as the draft's `saplingOutputs` entries are, and recovered with `try_output_recovery_with_ock` under Ironwood's note plaintext version for v6 transactions; tested on mainnet and testnet transactions.
- **Encoding and versioning:** we had to pick one. `receipt-v0` is a versioned JSON envelope per disclosed output (`spec/receipt-v0.md`), `zdp:1:` is the recipient-side note opening, and `zeceipt-dossier-v1` is the container. These are offered as input to the draft's encoding TODO, not as a claim on it; we would rather follow whatever the ZIP settles on.
- **Spend authority:** not implemented the draft's way. The draft re-proves each Sapling spend (`cv`, `rk`, a fresh spend proof, and `spendAuthSig` over a digest that binds the disclosure); an Orchard-family port needs the same with Halo 2 and a wallet that exposes `rsk`. Such a signature shows possession of the key that authorized a *past* spend. A source-of-funds reviewer asks a different question, whether the holder can spend the funds now, so the dossier answers with an on-chain control spend (or one dated by a block-hash beacon) and links notes by `nk`-derived nullifiers instead. Questions 1 and 3 below are where we need your view on how this should relate to ZIP 311.
- **UI:** a reviewer's case page and a holder's builder exist and could serve as a reference for the draft's UI TODO.

**What a dossier is**

A dossier = **ZIP 311 output disclosures** (OCK) for the payments the holder made + **note openings** for the notes the holder received + the account's **nullifier key `nk`**, whose nullifiers link one note to the transaction that spent it + a **control challenge** answered on chain. From these, five kinds of claim, each checked against chain data; the report then checks that they add up (every payment's funds trace back to an origin, and a lower bound on what was paid from undisclosed notes), so a small disclosed note cannot vouch for a large deposit:

| Claim | Disclosure | Check |
|---|---|---|
| **Deposit**: the holder paid this recipient, value and memo, from these notes | The output's OCK (`PRF^ock`, protocol spec §4.20), as ZIP 311's outputs; the funding notes' openings | `try_output_recovery_with_ock` recovers the note and checks it against `cmx`; each funding note's nullifier, derived from `nk`, is among the transaction's spends |
| **Origin**: these funds arrived in this note, in this transaction, funded by these transparent inputs or shielded spends | A `zdp:1:` note opening (receiver, value, rseed; the format of saplingcash/zcash-delivery-proof) | The note is rebuilt and checked against the action's `cmx`; funders' addresses and values are read from the outputs the inputs spend, never from `scriptSig` |
| **Path**: note A was spent in the transaction that created note B | Both openings, and `nk` | A's nullifier, derived from `nk` alone, is among that transaction's nullifiers |
| **Transparent payment**: the holder paid this transparent (or TEX) address this amount, from these notes: the usual exchange deposit | The funding notes' openings | The address and value are read from the output's script; each funding note's nullifier is among the transaction's spends |
| **Control**: after the reviewer issued a nonce, someone with spend authority over these notes acted | The reply note's opening | A mined transaction spends the listed notes (by nullifier) and pays a note whose memo carries the nonce |

**How it maps to ZIP 311's goals**

| ZIP 311 | Dossier |
|---|---|
| Disclose an output by its OCK | The same, for Ironwood outputs of v6 transactions (Orchard's note-encryption domain with `IronwoodVersion`), Orchard and Sapling. A deposit claim embeds our `receipt-v0` receipt unchanged |
| `msg`: bind the disclosure to a verifier's challenge | The reviewer's nonce, in the memo of a transaction that spends the disclosed notes. The memo is covered by the sighash that the spend authorization signatures sign, so the binding is the protocol's own |
| Proof of spend authority: a spend authorization signature over the disclosure, by a key that authorized an input | **An on-chain spend instead of an off-chain signature.** No mainstream wallet exposes a spend authorization signature over an arbitrary message for Orchard or Ironwood, and the Orchard address-signing draft (forum /t/53971) is not a ZIP. One implementation does, nonstandard: zally's `ZallyIronwood` profile (next section). The challenge transaction gives the same assurance (a spend authorizing key acted after the nonce) from any wallet, at the cost of a fee, a block and a transaction the reviewer can link. When a signature profile is agreed, a v2 control claim should use it |
| Creatable only by a sender of the transaction | Not met by a deposit alone: an OCK can be derived from the sender's viewing key, and anyone holding a disclosure has it. With `funded_by`, the payment is tied by nullifier to notes of the account whose `nk` is disclosed, and control ties that account to a spend authorizing key after the nonce |
| Non-malleable | Not met: a dossier is a bearer document. Freshness comes from the reviewer's nonce, checked against the nonce they issued and the height they issued it at |
| — (no counterpart) | **`funded_by` and paths.** ZIP 311 proves authority over a transaction's spends; a dossier shows *which disclosed notes* those spends were, and so chains disclosures into a history across transactions |

**Prior work on Ironwood: zally's `ZallyIronwood`**

[gustavovalverde/zally](https://github.com/gustavovalverde/zally) (crate `crates/zcash-payment-disclosure`, since 2026-07-11) already brings ZIP 311 to Ironwood, as an explicitly nonstandard profile (byte `0x02`, next to `Zip311Draft1`'s `0x01` for Sapling). For each real Ironwood spend it carries a RedPallas spend authorization signature over a digest that binds the profile, the txid and a message, checked against the randomized key `rk` of the mined action, plus the OCKs of the selected outputs. That is ZIP 311's spend-authority half on Ironwood, off chain, which is exactly what our control claim approximates with a transaction. @gustavovalverde, we would value your review of the dossier format, and would rather converge than fork: a v2 control claim could carry a `ZallyIronwood`-style signature over the reviewer's nonce, and the outputs half could share one encoding. The difference in scope is the history: a dossier's `nk`-derived nullifiers chain openings from an origin through each move to the payments, which a per-transaction disclosure does not attempt.

**The part we would most like reviewed: disclosing `nk`**

A note's nullifier depends on `nk` and the note only (protocol spec §4.16), so a verifier can compute it from a disclosed `nk` and a note opening. `orchard::Note::nullifier` takes a full viewing key and reads only `nk`, so we pass it `nk` with public filler `ak` and `rivk` (spec §3.1); the nullifiers computed this way for the testnet dossier's Ironwood notes are exactly those their spending transactions carry. The soundness argument (spec §3.3): a match between a derived nullifier and a mined transaction's nullifier means that transaction spent the note and `nk` is its owner's, up to a Poseidon PRF collision or a discrete logarithm on Pallas. The costs: whoever holds `nk` sees when any note whose opening they know is spent, including notes they sent the holder (spec §8). And the limit: nothing binds `nk` to a note's address until one of the note's nullifiers is on chain, so there is no "unspent at height H" claim (spec §4); a ZK proof that `nk` belongs to the key behind each address, or nullifier-exclusion proofs like those of zips#1198, would be the way to one.

**What exists, and the evidence**

- Rust crates (`zeceipt-core`, `zeceipt-types`), a CLI (`zeceipt dossier build|scan|verify|nonce|serve`), and the same checks in WebAssembly in a browser page for reviewers and a builder page for holders (the UFVK never leaves the page).
- A real dossier on testnet: a faucet origin, four hops, three payments disclosed by OCK and a control challenge mined at height 4,421,345. All 12 claims verify against a public node; forgeries fail at the claim they attack ([`docs/PROOF.md`](https://github.com/beautifulrem/zeceipt/blob/master/docs/PROOF.md) §8). Live: https://beautifulremi.dpdns.org/zeceipt/case/#sample
- A simulated exchange-deposit review on testnet (we ran the exchange's wallet): a withdrawal from a transparent hot wallet to a customer, the customer's transparent deposit back, and a control answer; 4 of 4 claims verify with control (PROOF §9). Live: https://beautifulremi.dpdns.org/zeceipt/case/#sample-exchange
- Test vectors: 36 patched copies of the real dossiers and 19 parse cases, with expected results, plus `nk` and each note's nullifier and spending transaction, so another implementation can check an `nk`-only derivation against chain data ([`spec/test-vectors/dossier-v1.json`](https://github.com/beautifulrem/zeceipt/blob/master/spec/test-vectors/dossier-v1.json)).
- Offline checks (transactions from files) are reported as `consistent_offline`, never as verified, since nothing binds a file to the chain.
- No mainnet dossier yet.

**Questions for the ZIP authors and the protocol engineers**

1. **Spend authority on Ironwood.** Would ZIP 311 accept an on-chain challenge spend as its proof of spend authority for Ironwood, as a separately labelled profile, until wallets can sign a message with a spend authorizing key? If not, what is the path to that signature API in librustzcash, and would you take a contribution towards it?
2. **Disclosing `nk`.** Is a disclosed `nk` (bytes 32..64 of the raw Orchard FVK) something ZIP 311, or a companion ZIP, should define, with its privacy cost stated? Or would you rather it disclosed each nullifier with a proof, and never `nk`?
3. **Encoding.** If ZIP 311 moves forward, we would align our field names and encoding with it and contribute our vectors. Are its field names settled enough to align with now, and is Ironwood (the `IronwoodVersion` note-encryption domain) in scope for its output disclosures?
4. **Memos after NU7.** zips#1376 (merged 2026-09-29) marks ZIP 231 as not deployed in NU7, so we read memos as today through NU7. If memo bundles come later, is a control claim's nonce best kept in the memo, or bound some other way?
5. **zally's profile.** Would a `ZallyIronwood`-style message signature be the basis for a standard Ironwood spend-authority profile in ZIP 311? If so, we would move control to it.

**The committee's four questions**

ZCG's 2026-09-28 minutes ([forum /t/57928](https://forum.zcashcommunity.com/t/57928)), on grant applications #437 and #426 (ZCG's numbering, not this repository's PR #426), set out what a disclosure tool needs. Our honest answers today:

1. **"This usually needs to come out of a wallet team."** Agreed, and we are not one. The builder is a library call (`buildDossier` in `@zeceipt/verify`, `zeceipt_core::dossier::build`) that a wallet runs locally with the UFVK and transaction list it already has; the control answer is a send to self with a memo, which every wallet can make. We have drafted issues for Zodl and Zingo, but no wallet team has responded yet. We would rather this lives in a wallet than beside one.
2. **"Break privacy in some subtle way."** There is one, and we state it: `nk` lets whoever holds it see when any note whose opening they know is spent, past and future. That includes every note they ever sent the holder, so an exchange that sent withdrawals to the holder can follow those notes' spends, not only the disclosed ones (spec §8.1). The builder and the case page say so, and recommend moving the remaining funds to a fresh account after the case. Other costs: the openings show receivers and memos, and the set of txids is visible to the node that serves them. We would welcome a review that finds more.
3. **"A ZIP and coordination with the protocol developers."** This report is that start: the format is written as a spec with vectors, and we would change it to fit ZIP 311, or write a companion ZIP for `nk` disclosure and the control challenge, with whoever owns ZIP 311 and with zally's author.
4. **"Potential users showing demand."** Public demand exists (Kraken's EDD emails, /t/55347; a $589k NEAR Intents hold answered with screenshots, /t/57497), but no reviewer has accepted a dossier yet, and no holder has used one in a real case. We are asking reviewers to try it now; we will report what they say, including "no".

We would be glad to change the format to match the ZIP, and to do the Ironwood work the committee suggested alongside the protocol engineers.
