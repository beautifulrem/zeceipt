<!--
DRAFT, not posted (WBS 3.3.3.4, REQ-INT-4; appraisal round 1, D19). Posting is the owner's decision: a public comment on
https://github.com/zcash/zips/issues/387 (ZIP 311, Zcash Payment Disclosures). A shorter version could also go in the #437 forum thread (/t/57729).
Rewritten 2026-09-30 for the pivot: the receipts-era report ("the outputs half of ZIP 311") is in git history, and its questions 1–3 are folded in below.
Sources: hanh's #437 decision, forum /t/57729/4, read 2026-09-30 (R138); ZCG #437 closed "Grant Declined" 2026-09-30 13:25 UTC (R138).
Every technical sentence is backed by `spec/dossier-v1.md` (§3 nullifiers from nk, §4 no unspent claim, §7 control), `docs/PROOF.md` §8 and the tests.
Before posting: if spec/dossier-v1.md's section numbers have moved, fix the § references; if a mainnet dossier exists, add it to "Evidence"; if the
transparent_payment claim is committed, name it under "What exists". Question 4 (ZIP 231) is unverified: drop it if the NU7 ZIP set is known by then.
-->

**An implementation report: ZIP 311 output disclosures on Ironwood, extended with note openings, nullifier paths and a control challenge**

On 2026-09-30 ZCG declined a standalone receipts SDK (#437) with this note from hanh ([forum /t/57729/4](https://forum.zcashcommunity.com/t/57729/4)):

> The committee believes a standalone implementation will not deliver sufficient value to the community, but agrees that payment receipts are useful. We refer you to ZIP 311: Zcash Payment Disclosures and would encourage you to bring it to Ironwood with support from the protocol engineers.

We built on the same primitive and took the same advice, so here is what we have, how it maps to ZIP 311, and where we need the protocol engineers' judgement. Zeceipt ([github.com/beautifulrem/zeceipt](https://github.com/beautifulrem/zeceipt), Apache-2.0) implements ZIP 311's output disclosures for Ironwood (and Orchard and Sapling), and uses them in a **source-of-funds dossier** ([`spec/dossier-v1.md`](https://github.com/beautifulrem/zeceipt/blob/master/spec/dossier-v1.md)): what a holder of shielded ZEC hands an exchange or OTC desk that asks where the funds came from, instead of a viewing key or a deshield.

**What a dossier is**

A dossier = **ZIP 311 output disclosures** (OCK) for the payments the holder made + **note openings** for the notes the holder received + the account's **nullifier key `nk`**, whose nullifiers link one note to the transaction that spent it + a **control challenge** answered on chain. From these, four kinds of claim, each checked against chain data:

| Claim | Disclosure | Check |
|---|---|---|
| **Deposit**: the holder paid this recipient, value and memo, from these notes | The output's OCK (`PRF^ock`, protocol spec §4.20), as ZIP 311's outputs; the funding notes' openings | `try_output_recovery_with_ock` recovers the note and checks it against `cmx`; each funding note's nullifier, derived from `nk`, is among the transaction's spends |
| **Origin**: these funds arrived in this note, in this transaction, funded by these transparent inputs or shielded spends | A `zdp:1:` note opening (receiver, value, rseed; the format of saplingcash/zcash-delivery-proof) | The note is rebuilt and checked against the action's `cmx`; funders' addresses and values are read from the outputs the inputs spend, never from `scriptSig` |
| **Path**: note A was spent in the transaction that created note B | Both openings, and `nk` | A's nullifier, derived from `nk` alone, is among that transaction's nullifiers |
| **Control**: after the reviewer issued a nonce, someone with spend authority over these notes acted | The reply note's opening | A mined transaction spends the listed notes (by nullifier) and pays a note whose memo carries the nonce |

**How it maps to ZIP 311's goals**

| ZIP 311 | Dossier |
|---|---|
| Disclose an output by its OCK | The same, for Ironwood outputs of v6 transactions (Orchard's note-encryption domain with `IronwoodVersion`), Orchard and Sapling. A deposit claim embeds our `receipt-v0` receipt unchanged |
| `msg`: bind the disclosure to a verifier's challenge | The reviewer's nonce, in the memo of a transaction that spends the disclosed notes. The memo is covered by the sighash that the spend authorization signatures sign, so the binding is the protocol's own |
| Proof of spend authority: a spend authorization signature over the disclosure, by a key that authorized an input | **An on-chain spend instead of an off-chain signature.** No wallet we found exposes a spend authorization signature over an arbitrary message for Orchard or Ironwood; the Orchard address-signing draft (forum /t/53971) is not a ZIP, and nothing covers Ironwood. The challenge transaction gives the same assurance (a spend authorizing key acted after the nonce), at the cost of a fee, a block and a transaction the reviewer can link. When a signature API exists, a v2 control claim should use it |
| Creatable only by a sender of the transaction | Not met by a deposit alone: an OCK can be derived from the sender's viewing key, and anyone holding a disclosure has it. With `funded_by`, the payment is tied by nullifier to notes of the account whose `nk` is disclosed, and control ties that account to a spend authorizing key after the nonce |
| Non-malleable | Not met: a dossier is a bearer document. Freshness comes from the reviewer's nonce, checked against the nonce they issued and the height they issued it at |
| — (no counterpart) | **`funded_by` and paths.** ZIP 311 proves authority over a transaction's spends; a dossier shows *which disclosed notes* those spends were, and so chains disclosures into a history across transactions |

**The part we would most like reviewed: disclosing `nk`**

A note's nullifier depends on `nk` and the note only (protocol spec §4.16), so a verifier can compute it from a disclosed `nk` and a note opening. `orchard::Note::nullifier` takes a full viewing key and reads only `nk`, so we pass it `nk` with public filler `ak` and `rivk` (spec §3.1); the nullifiers computed this way for the testnet dossier's Ironwood notes are exactly those their spending transactions carry. The soundness argument (spec §3.3): a match between a derived nullifier and a mined transaction's nullifier means that transaction spent the note and `nk` is its owner's, up to a Poseidon PRF collision or a discrete logarithm on Pallas. The costs: whoever holds `nk` sees when any note whose opening they know is spent, including notes they sent the holder (spec §8). And the limit: nothing binds `nk` to a note's address until one of the note's nullifiers is on chain, so there is no "unspent at height H" claim (spec §4); a ZK proof that `nk` belongs to the key behind each address, or nullifier-exclusion proofs like those of zips#1198, would be the way to one.

**What exists, and the evidence**

- Rust crates (`zeceipt-core`, `zeceipt-types`), a CLI (`zeceipt dossier build|scan|verify|nonce|serve`), and the same checks in WebAssembly in a browser page for reviewers and a builder page for holders (the UFVK never leaves the page).
- A real dossier on testnet: a faucet origin, four hops, three payments disclosed by OCK and a control challenge mined at height 4,421,345. All 12 claims verify against a public node and offline; forgeries fail at the claim they attack ([`docs/PROOF.md`](https://github.com/beautifulrem/zeceipt/blob/master/docs/PROOF.md) §8). Live: https://beautifulremi.dpdns.org/zeceipt/case/#sample
- Test vectors: 20 patched copies of that dossier and 17 parse cases, with expected results, plus `nk` and each note's nullifier and spending transaction, so another implementation can check an `nk`-only derivation against chain data ([`spec/test-vectors/dossier-v1.json`](https://github.com/beautifulrem/zeceipt/blob/master/spec/test-vectors/dossier-v1.json)).
- No mainnet dossier yet.

**Questions for the ZIP authors and the protocol engineers**

1. **Spend authority on Ironwood.** Would ZIP 311 accept an on-chain challenge spend as its proof of spend authority for Ironwood, as a separately labelled profile, until wallets can sign a message with a spend authorizing key? If not, what is the path to that signature API in librustzcash, and would you take a contribution towards it?
2. **Disclosing `nk`.** Is a disclosed `nk` (bytes 32..64 of the raw Orchard FVK) something ZIP 311, or a companion ZIP, should define, with its privacy cost stated? Or would you rather it disclosed each nullifier with a proof, and never `nk`?
3. **Encoding.** If ZIP 311 moves forward, we would align our field names and encoding with it and contribute our vectors. Are its field names settled enough to align with now, and is Ironwood (the `IronwoodVersion` note-encryption domain) in scope for its output disclosures?
4. **NU7.** Does NU7 change where a memo lives (ZIP 231, memo bundles)? The control challenge reads the nonce from a memo, so we would like to know before mainnet activation on 2026-11-05. (We have not confirmed ZIP 231's status for NU7.)

We would be glad to change the format to match the ZIP, and to do the Ironwood work the committee suggested alongside the protocol engineers.
