# Zeceipt source-of-funds dossier v1 (`zeceipt-dossier-v1`)

Status: implemented (crates `zeceipt-types::dossier`, `zeceipt-core::dossier`; CLI `zeceipt dossier build|verify|nonce|scan|serve`; WASM and `@zeceipt/verify` `checkDossier`, `buildDossier`, `scanWallet`). Claims and verification first landed in `04f32d1`, the transaction scan (§6.1) in `6d35571`, the fixes from the spec review in `b9650dd`, and transparent payments, the issue height and `assurance` in the commit that changed this paragraph. This document describes that code and is normative for v1; the vectors (§11) are run against it by `crates/zeceipt-core/tests/dossier_vectors.rs` (native) and `packages/verify/test/dossier-vectors.mjs` (WASM) in CI. Written 2026-09-30, revised the same day.

## 1. Purpose and non-goals

A dossier is what a holder of shielded ZEC hands a reviewer (an exchange's compliance team, an OTC desk, a bridge, a lender) instead of a viewing key. It makes a list of claims about specific funds, and the reviewer checks each against chain data:

- **origin**: these funds arrived in this note in transaction T, and T was funded by the transparent inputs or shielded spends that T itself shows. The note is shown to be the holder's only when a transaction in the dossier spends it with the dossier's `nk` (§5.3);
- **path**: the funds in note A were spent in the transaction that created note B;
- **deposit**: this shielded payment (recipient, value, memo) was made, from these notes;
- **transparent_payment**: this transparent output (an exchange's deposit address, a TEX address) was paid from these notes;
- **control**: after the reviewer issued a nonce (and, when they give it, above the chain height they issued it at), someone spent these notes in a transaction whose output memo carries it.

The dossier discloses what its claims need and nothing more of the account: note openings (§2.2), sender receipts (§2.3) and the nullifier-deriving key `nk` (§3). It never contains an incoming, outgoing or full viewing key.

Non-goals. A dossier does not prove:
- who the counterparties are. An origin names the transparent addresses whose inputs funded T, not who holds them;
- the value of inputs it does not disclose. They are counted, not valued;
- anything about notes, payments or balances it does not disclose. It cannot show completeness, and it cannot show that the holder has no other funds or other history;
- that funds are unspent now (§4);
- who is presenting it (§7.2);
- who a note belongs to, unless its nullifier under `nk` is found on chain (§3.3);
- anything legal. It is evidence a reviewer weighs, not an attestation.

Only Orchard-family notes (Ironwood and Orchard pools) are covered. Sapling and transparent funds of the holder cannot be the subject of a claim; a Sapling spend or a transparent input of a transaction is only counted or named as a funder.

## 2. Format

A JSON object. Unlike receipt-v0 (whose verifiers ignore unknown fields), a dossier is parsed with `deny_unknown_fields` at the top level and in every claim: an unknown field or claim type is a parse error (an embedded receipt keeps receipt-v0's rule). A reviewer must never see a dossier "verified" while some part of it was silently skipped.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string | yes | `"zeceipt-dossier-v1"`. Any other value is refused. |
| `network` | `"main"` \| `"test"` \| `"regtest"` | yes | Every receipt must name the same network. Selects the node and how addresses are written. |
| `created` | string | no | RFC 3339 UTC, when the holder built it. Informational, unauthenticated. |
| `subject` | string | no | Free text from the holder (a name, a case number). Unauthenticated. |
| `nk` | hex, 32 bytes | if any claim needs it | The account's Orchard nullifier-deriving key (§3). Required when the dossier has a `path`, `control` or `transparent_payment` claim, or a `deposit` claim with a non-empty `funded_by`. |
| `notes` | object: id → `zdp:1:` string | yes | The disclosed notes (§2.2). |
| `receipts` | object: id → receipt-v0 object | no | Sender receipts for payments the holder made (§2.3). |
| `claims` | array of claims | yes, non-empty | §2.4. |

### 2.1 Ids

Note and receipt ids are strings chosen by the builder (`n1`, `n2`, …; `r1`, …). They exist only to be named by claims. Every id a claim names must exist in `notes` or `receipts`.

A dossier **must not** disclose one output (txid, pool, action) under two note ids, and a claim **must not** list one note twice. Verifiers refuse either at parse ("notes n4 and n4b open the same note"; "claim 11 (control) lists note n4 twice"), since otherwise a value would be counted twice (§5.4). Parse cases `duplicate_output`, `duplicate_in_claim`, `duplicate_in_funded_by`.

`nk` is checked for length at parse. If its 32 bytes are not a valid Orchard nullifier-deriving key encoding (a canonical Pallas base field element, protocol §5.6.4.4), the dossier still parses. Verification then reports it once in the report's `problems`, and every claim that tests a nullifier fails with "nk is not a valid key, so no nullifier can be tested" (vector `invalid_nk`).

### 2.2 Note openings (`zdp:1:`)

Each note is disclosed as a [zcash-delivery-proof](https://github.com/saplingcash/zcash-delivery-proof) `SPEC.md` version 1 opening (receipt-v0 §11): `zdp:1:` then 118 bytes in base64url without padding. The bytes are the txid (internal order, 32), the pool (1 = Orchard, 2 = Ironwood), the action index (u16 LE), the receiver (43), the value (u64 LE) and the rseed (32). It is checked exactly as that specification's §4 says: the transaction's bytes must be canonical and have that txid; the note rebuilt from the receiver, the value, the rseed and ρ (the action's nullifier field) must have the action's `cmx`; and the ephemeral key derived from the note must decrypt the action's `enc_ciphertext` to exactly that note. The memo comes out of that authenticated decryption.

A note opening is known to the note's recipient (incoming viewing key) and to its sender (outgoing viewing key or their own records). So an opening shows that the note exists and what it holds, **not** whose it is (§5.3).

### 2.3 Receipts

Receipts are receipt-v0 envelopes (`spec/receipt-v0.md`), verified by its §4 with no expected challenge; a signature is optional and, if present, must verify. A receipt opens one output the holder paid, via that output's OCK. The builder never binds a challenge, so a dossier's receipts carry none.

### 2.4 Claims

Each claim is an object with `type` and exactly the fields below.

| `type` | Fields | Needs `nk` | Holds when |
|---|---|---|---|
| `origin` | `note` | not at parse; without it an origin is at best `unproven` | The note opens (§2.2), and its nullifier under `nk` is among the spends of a transaction the verifier was given, which shows the note is the holder's. The report states what funded the note's transaction: its transparent inputs (each prevout, with the address and value of the output it spends, read from the previous transaction, and the dossier's `transparent_payment` claim that paid that output, if any), its count of Orchard-family actions and Sapling spends, and which disclosed notes it spends. |
| `path` | `from`, `to` | yes | Both notes open, and the nullifier of `from` under `nk` is among the nullifiers of the transaction that created `to`. |
| `deposit` | `receipt`, `funded_by` (list, may be absent or empty) | if `funded_by` is non-empty | The receipt verifies against its transaction, and the nullifier of every note in `funded_by` under `nk` is among that transaction's nullifiers. |
| `transparent_payment` | `tx` (a txid: 64 lowercase hex characters), `output` (an index), `funded_by` (non-empty list) | yes | `tx` has a transparent output `output`, whose address (P2PKH or P2SH) and value are read from its script, and the nullifier of every note in `funded_by` under `nk` is among `tx`'s nullifiers. |
| `control` | `nonce` (≥ 8 characters after trimming), `reply`, `spent` (non-empty list) | yes | Every note opens; `nonce` equals the reviewer's expected nonce, when one is given; the memo of `reply` contains `nonce`; the nullifier of every note in `spent` under `nk` is among the nullifiers of the transaction that created `reply`; that transaction is mined, and not below the height the reviewer issued the nonce at, when they give it. |

There is no claim that notes are unspent at some height. §4 says why. A `holding` claim is a parse error (unknown variant).

## 3. Nullifiers from `nk` alone

### 3.1 Derivation

For an Orchard-family note with commitment `cm`, `ρ` and `ψ` (ψ derived from the note's rseed and ρ), the protocol specification (§4.16) defines

```
nf = Extract_P( [ (PRF^nfOrchard_nk(ρ) + ψ) mod q_P ] · K^Orchard + cm )
```

with `PRF^nfOrchard` the Poseidon-based PRF keyed by `nk`, and `K^Orchard` a fixed generator. The inputs are `nk` and the note. The spend authorizing key, `ak` and `rivk` do not appear. Ironwood notes use the same derivation in the `orchard` crate (0.15.5) zeceipt builds on (`Note::nullifier` for both pools; only the note plaintext version differs). The testnet dossier (§11) is the evidence: the nullifiers computed this way for n1 to n4, all Ironwood notes, are the ones found on chain in the transactions that spent them.

`orchard::Note::nullifier` takes a `FullViewingKey` and reads only its `nk`. A dossier carries `nk` alone, so a verifier builds a key that carries the disclosed `nk` with public filler values in place of the other two components (`nullifier_key` in `zeceipt-core::dossier`):
- `ak` = `6ebb833c1d2f8433080abceabe47906097f90678d603f577d0486c9111737b07`: the spend validating key of the Orchard spending key whose 32 bytes are all `0x07`, a published test value;
- `rivk` = the integer `t + 1` (32 bytes, little-endian), for the first `t` in 0..7 for which `FullViewingKey::from_bytes` accepts the 96 bytes. It refuses a key whose incoming viewing key, external or internal, would be zero or ⊥; for a given `nk`, one filler hits that with negligible probability, so the next is tried.

The nullifier does not depend on the filler: any `t` gives the same `nf`.

### 3.2 What the filler key can and cannot do

The filler key's incoming and outgoing viewing keys are derived from the filler `ak` and `rivk` (`ivk = Commit^ivk_rivk(ak, nk)`, §4.2.3), so they are not the account's. It decrypts none of the account's notes, recovers none of its outgoing outputs, and derives none of its addresses. Its spend validating key belongs to the public `0x07` key, so its "addresses" are addresses nobody should pay. The verifier uses it only for `Note::nullifier`, and never derives an address, an incoming viewing key or an outgoing viewing key from it.

What `nk` itself gives whoever holds it:
- the nullifier of any note whose opening they also know (ρ is public on chain; ψ and `cm` need the note's rseed, value and receiver, which only its sender and recipient know);
- nothing else. `nk` is one of the three components of an Orchard full viewing key (`ak`, `nk`, `rivk`); without the other two there is no incoming or outgoing viewing key, so nothing decrypts, and with no spend authorizing key nothing can be spent. Without the notes' openings it cannot tell which on-chain nullifiers are the account's.

### 3.3 Soundness of a nullifier match

Claim: if the nullifier computed from a disclosed `nk` and a disclosed, opened note N is among the nullifiers of a mined transaction U, then U spent N.

Argument (informal; relies on the protocol's own assumptions):
1. U is mined, so each of its actions satisfies the Action statement (protocol §4.18.4). The spent note N_old is committed in the tree (except for dummy and split notes); its address comes from some `(ak, nk_old, rivk)`; its revealed nullifier is `nf_old = DeriveNullifier_nk_old(N_old)`; and the transaction carries a spend authorization signature under a randomization of that `ak`.
2. The opening of N was checked against the `cmx` of the action that created it, and N's ρ is that action's nullifier field. So `cm`, ρ and ψ are those of a real output.
3. Suppose the verifier's `nf = DeriveNullifier_nk(N)` equals `nf_old`.
   - If N_old is N, U spent N. Moreover, `nk` must be `nk_old`. Otherwise `Extract_P` of the two points agrees, so the points are equal or opposite. Equal points need `PRF_nk(ρ) ≡ PRF_nk_old(ρ)`: a collision in the Poseidon PRF. Opposite points need `[a + a']·K = −2·cm`: a discrete-logarithm relation between `K^Orchard` and a note commitment.
   - If N_old is not N, the disclosed pair (N, `nk`) maps to another note's nullifier. For a fixed target, `nk` enters only through the PRF output, so hitting a given point takes about `q_P` tries, or a discrete-log relation among `K^Orchard`, `cm` and the target point. This is the same property that makes Orchard nullifiers unique per note.
4. So, up to a Poseidon collision or a discrete logarithm on Pallas, a match means that U spent N, and that `nk` is the nullifier key of N's owner.

Consequences:
- **A wrong `nk` produces nullifiers that appear nowhere.** Every claim that tests one fails, and no claim passes because of one (vector `wrong_nk`: the 11 nullifier claims fail, and the origin is `unproven` because its note is no longer shown to be the holder's).
- **Only notes whose nullifier is found are bound to `nk`.** In the testnet dossier that is n1 to n4. The others (n5 to n9) are outputs of transactions the holder authorized, but no claim shows that they belong to the holder: a payment to someone else and a change note look alike. The report says so (§5.3).
- **Same `nk` does not mean same person.** The Action statement ties the address to `(ak, nk, rivk)`, but not `nk` to the key that signs. ZIP 32 wallets derive all three from one spending key, so for them one `nk` is one account. A key built outside ZIP 32 can reuse an `nk` it has learned, and a dossier discloses its `nk` to the reviewer. Examples are ZIP 312 FROST keys, whose `ak` is the signing group's key. So a colluding party with such a key could make notes that read as this account's. A dossier proves facts about the notes of one `nk`, not about one person.

## 4. Why there is no "unspent at height H" claim

The obvious proof of funds would disclose notes and `nk`, and show that no nullifier of those notes appears on chain up to height H. It is unsound without a zero-knowledge proof, because **nothing binds `nk` to a note's owner until one of that note's nullifiers appears on chain**:
- A wrong `nk` (random bytes, or another account's) gives a nullifier that will never appear, so the notes read as unspent forever, whether or not their owner has spent them.
- A note opening is known to the note's sender as well as its recipient. A holder can disclose a note they *sent* to someone else, with their own `nk`. The note opens (vector `origin_of_a_sent_note`), and its computed nullifier never appears, even after the real owner spends it.

To check `nk` against a note's address, a verifier needs `ak` and `rivk` too (`pk_d = [Commit^ivk_rivk(ak, nk)]·g_d`), that is, the full viewing key, which is what a dossier exists to avoid disclosing. The alternative is a zero-knowledge proof that the disclosed `nk` is part of the key behind each note's address. That is not in v1. Monero's reserve proofs avoid this problem because each key image comes with a signature by the output's key. A disclosed Zcash nullifier comes with nothing similar.

So every v1 claim that uses `nk` tests a nullifier that **is** on chain, which a wrong `nk` cannot produce (§3.3). Current funds are shown by spending them: `control` (§7). It proves spend authority at the height of the challenge transaction, and nothing after it.

## 5. Verification

### 5.1 Inputs

The verifier parses the dossier (§2). On any failure it returns `{"all_verified": false, "stage": "parse", "error": …}` (CLI exit 1). Otherwise it fetches transactions in two rounds from a node it trusts:
1. `txids_needed`: the txid of every note, every receipt and every `transparent_payment` claim, deduplicated;
2. `prevout_txids`: the previous transactions whose outputs the origin claims' transactions spend through transparent inputs, so that each funder's address and value can be read from the spent output (§5.3, origin).

Each transaction arrives with the height the node reports it mined at, and whether the node reports it in the mempool:
- **mined**: height known;
- **mempool**: the node returned it with no mined height (lightwalletd height 0 or `u64::MAX`);
- **file**: loaded from `--raw-tx-dir <dir>/<txid>.hex` (CLI) or passed in `{ txs }` (JS/WASM) with `height: null`. The height is unknown and inclusion is not checked;
- **absent**: the node does not know it (gRPC NotFound), or there is no file for it. It is left out, and the claims that need it say so. A missing file does not stop the CLI.

In `{ txs }`, a transaction whose hex does not decode is kept as empty bytes, so its notes report it malformed rather than missing (vector `control_tx_bad_hex`).

`check_dossier_with(dossier, raw, txs, options)` does no I/O: the CLI (native gRPC), the HTTP service and the browser (gRPC-web, WASM) run the same checks on what the caller fetched. The options are what the reviewer knows about their challenge:
- `expect_nonce`, the nonce they issued: CLI `dossier verify --expect-nonce`, HTTP `?expect_nonce=`, JS `checkDossier(text, { expectNonce })`;
- `issued_at_height`, the chain height when they issued it (H₀, §7.1): CLI `--issued-at-height`, HTTP `&issued_at_height=`, JS `{ issuedAtHeight }`.

`check_dossier(dossier, raw, txs, expect_nonce)` is the same with no issue height.

When it fetches from a node, the CLI (and the service) first asks the node which chain it serves (`GetLightdInfo`'s `chain_name`), and refuses a dossier of another network: a reviewer's own `--endpoint` cannot be fooled by a relabelled dossier either. The CLI and the HTTP service also refuse a dossier whose `network` is not the one a `--testnet` or `--regtest` flag names (CLI exit 1 with `"stage": "network"`; HTTP 422): its txids would be looked up on the wrong chain, and a testnet dossier relabelled `main` would read as mainnet ZEC. Offline, nothing binds a transaction to a network; that is one more reason offline reports are `consistent_offline`.

### 5.2 Per note

`spent_at` maps every nullifier of every supplied transaction (Ironwood and Orchard actions, real and dummy) to that transaction. For each note id, the verifier opens the note (§2.2) against its transaction's bytes. If it opens, the verifier records:
- the recipient (written for the dossier's network), value, memo and height;
- when `nk` is a valid key, the note's nullifier (§3.1);
- `spent_in`: the supplied transaction whose spends contain that nullifier, if any. A note with `spent_in` is shown to be the holder's (§3.3). A note without it is not: its sender knows its opening too.

If the transaction is absent, the note records "its transaction was not found on the node, or not supplied". If the note does not open, it records why.

### 5.3 Per claim

Each claim gets a status, a one-sentence summary, and details.
- `verified`: every check passed.
- `failed`: a check failed.
- `not_checked`: a transaction the claim rests on is absent or in the mempool. Checking again later, or with the missing transaction, can change it.
- `unproven` (origin only): its note opens, but nothing supplied shows it is the holder's, since no supplied transaction spends it with `nk`. Waiting does not change that; a later claim that spends the note (a path, a payment, a control) does.

`all_verified` is true only if every claim is `verified`.

With `spends(tx)` the disclosed notes whose nullifier is in `tx`:

- **Every claim, first.** If a note the claim names has an absent transaction: `not_checked`, "The transaction of note nX (…) was not found on the node, or not supplied." (vector `control_tx_missing`).
- **origin(note)**
  1. The note opens, else `failed`.
  2. Report the funding of its transaction:
     - transparent inputs, each with its prevout. The **address** (P2PKH or P2SH) and **value** are read from the spent output's script in the previous transaction, when that transaction was supplied and hashes to the prevout's txid. They are never read from the input's `scriptSig`: that is authorizing data, outside a v5/v6 txid (ZIP 244, A.1), so a node or a file could put any key there. When the previous transaction is missing, the address and value are absent, and the summary says "(their previous transactions were not supplied)";
     - the number of Orchard-family actions and of Sapling spends;
     - `spends(tx)`.
  3. The summary is "X arrived in note n, in T, funded by …". The funding named is one source, in this order: the disclosed notes spent; else the transparent inputs, with their total value when every value is known, and their addresses, and ", which the holder paid there from disclosed notes (transparent payment T′:k)" for inputs that spend the output of one of this dossier's `transparent_payment` claims (named by outpoint, since readers number claims from 0 or 1; the input's `paid_in_claim` is the claim's index) (funds that left the shielded pool and came back); else "the shielded pool by an undisclosed sender".
  4. `verified` if the note has `spent_in`, with the detail "n was later spent with this dossier's nk (in U), so it belonged to that account". Otherwise `unproven`, with the detail "Nothing here shows n is the holder's: its nullifier is in no supplied transaction, and the sender of a note knows its opening too…". A note the holder sent to someone else lands here (vector `origin_of_a_sent_note`), and so does the holder's own note that no supplied transaction spends (vector `origin_of_an_unspent_own_note`).
- **path(from, to)**
  1. `nk` is absent or invalid: `failed`. A note does not open: `failed`, naming which.
  2. Take the transaction that created `to`. If `from ∈ spends(tx)`: `verified`, "X in from was spent in T, which created to (Y)". The details list any other disclosed notes it spends, and, when `to` has no `spent_in`, say "to is not shown to be the holder's: that transaction may have paid it to someone else (a change note and a payment look alike here)". Else `failed`: "from's nullifier, derived with this dossier's nk, is not among T's spends: that transaction did not spend from with this account's key".
- **deposit(receipt, funded_by)**
  1. The receipt's transaction is absent: `not_checked`. It does not parse, or the receipt does not verify (receipt-v0 §4, no expected challenge, signature optional): `failed`.
  2. `funded_by` is non-empty and `nk` is invalid: `failed`. A note in `funded_by` is not in `spends(tx)`: `failed`, "Receipt r opens a payment of … but not from n…: their nullifiers are not among its spends".
  3. Otherwise `verified`. With `funded_by`, the summary reads "The holder paid X to A (memo "M") in T, from n… (Y disclosed)". Without it, the summary reads "The receipt opens a payment of …". A detail then says that nothing ties the payment to the holder's other notes, and that whoever knows the output's OCK could make this receipt (vector `deposit_without_funded_by`). A signed receipt's key goes in the details.
- **transparent_payment(tx, output, funded_by)**
  1. `nk` is absent or invalid: `failed`. A note in `funded_by` does not open: `failed`.
  2. `tx` is absent: `not_checked` (vector `transparent_payment_tx_missing`). It does not parse: `failed`. It has no transparent output `output`: `failed`, "T has no transparent output k" (vectors `transparent_payment_no_such_output`, `transparent_payment_to_a_shielded_tx`).
  3. The output's value and address are read from its script (P2PKH or P2SH; any other script is "a non-standard script"), and reported as `value_zat` and `paid_to`. A note in `funded_by` is not in `spends(tx)`: `failed`, "T pays X to A (transparent output k) …, but not from n…" (vector `transparent_payment_not_funded_by`).
  4. Otherwise `verified`, "The holder paid X to A (transparent output k) in T at height H, from n… (Y disclosed)". The recipient of a transparent output is public on chain anyway; what the claim adds is the link from the holder's notes to it, which is what an exchange asks about a deposit it received.
- **control(nonce, reply, spent)**
  1. `nk` is absent or invalid: `failed`. A note does not open: `failed`.
  2. An expected nonce was given and differs from `nonce`: `failed`, "This control claim answers nonce N, not the one you issued: it was made for another challenge, or an earlier one" (vector `replayed_control`).
  3. Take the transaction that created `reply`. Its memo does not contain `nonce`: `failed` (vector `nonce_mismatch`). A note in `spent` is not in `spends(tx)`: `failed`, naming it.
  4. An issue height H₀ was given, and the reply's transaction was mined at a known height below it: `failed`, "The challenge transaction T was mined at height H, before you issued the nonce at height H₀: it was not made in answer to your challenge" (vector `control_before_issue`).
  5. Otherwise `verified`, "Answering nonce N, the holder spent n… (X) in T at height H: they could spend these funds after the nonce was issued". `value_zat` is the sum of the `spent` notes' values. Without an expected nonce, a detail asks the reviewer to check that N is the nonce they issued. With H₀, a detail says the transaction was mined after it, or, for a transaction from a file, that its height was not checked against H₀ (vector `issue_height_without_heights`).
- **Inclusion, every claim that passed its checks.** The claim rests on the transactions it names: its note's transaction and its `spent_in` transaction (origin); `from`'s and `to`'s (path); the receipt's and `funded_by`'s (deposit); `tx` and `funded_by`'s (transparent_payment); the reply's and `spent`'s (control). If any of them is in the mempool, the claim becomes `not_checked`, with the detail "T in the mempool, not mined yet: check again once mined" (vectors `control_tx_in_mempool`, `every_tx_in_mempool`). If any came without a height (a file), the detail "Loaded without a height (from a file): the inclusion of T in the chain was not checked here" is added, and the status is kept.

Amounts are written TAZ on testnet and regtest and ZEC on mainnet.

**Supplied transactions are keyed by their own txid.** Before any check, every supplied transaction whose bytes parse is filed under the txid recomputed from those bytes. One supplied under another txid is set aside, with the problem "a transaction supplied as A is B: set aside", so a mislabelled file cannot stand in for the transaction a claim names, or make `spent_in` name the wrong one. Bytes that do not parse keep their label, so the note that names them reports them malformed.

The three gaps recorded in the first draft of this section are closed: an origin's inclusion now lists its `spent_in` transaction; `spent_at` is keyed by recomputed txids (above); and `unproven` is separate from `not_checked`, with its own exit code (§5.5).

### 5.4 Sums

Any value summed over notes (the control's `value_zat`, a deposit's disclosed `funded_by` value) counts each output once, because §2.1 refuses duplicates at parse. This matches receipt-v0 §8's rule for packs.

### 5.5 Report (`zeceipt-dossier-report-v1`)

```
{
  "version": "zeceipt-dossier-report-v1",
  "network": "main" | "test" | "regtest",
  "nk_proven": bool,                        // some disclosed note has spent_in: nk is that account's
  "controlled": bool,                       // a control claim verified against the reviewer's expected nonce
  "problems"?: [string],                    // dossier-level problems: an nk that is not a key, a mislabelled
                                            // transaction, an expected nonce that no control claim answers
  "subject": string?,                       // copied from the dossier; unauthenticated
  "dossier_sha256": hex,                    // sha256 of the dossier text exactly as given, for a case file
  "notes": { id: {
      "txid", "pool", "action",
      "height"?, "recipient"?, "value_zat"?, "memo"?,
      "nullifier"?,                         // when nk is a valid key
      "spent_in"?,                          // the supplied tx that spends it: the note is the holder's
      "error"? } },                         // why the note did not open, or its tx is absent
  "claims": [ {
      "index", "kind", "status": "verified" | "failed" | "not_checked" | "unproven",
      "summary",                            // one sentence
      "details"?: [string],
      "funding"?: { "transparent_inputs": [{ "prevout": "txid:n", "address"?, "value_zat"?,
                                             "paid_in_claim"? }],   // the transparent_payment claim that paid it
                    "shielded_actions", "sapling_spends", "from_disclosed": [id] },   // origin
      "value_zat"?,                         // control: the spent notes; deposit, transparent_payment: the payment
      "paid_to"?,                           // transparent_payment: the output's address
      "undisclosed_input_min_zat"? } ],     // §5.6, when above 0                       // transparent_payment: the output's address
  "all_verified": bool,                     // every claim verified and no problems
  "assurance": "verified_with_control" | "verified_history_only" | "verified_partly_explained"
             | "consistent_offline" | "not_verified",
  "anchored": bool,                         // every transaction the claims name came from a node, with a height
  "untraced"?: [id],                        // funding notes no chain of paths leads back to an origin (§5.6)
  "undisclosed_input_min_zat": number,      // at least this much was paid from unexplained funds (§5.6)
  "unexplained_origins"?: [id],             // origins that name no source (§5.6)
  "unvalued_inputs"?: number,               // transparent inputs of unknown value (§5.6)
  "beacon_height"?: number,                 // the block a verified beacon control answers (§7.4)
  "deposit_address_paid"?: bool,            // when the reviewer gave the deposit address they assigned (§7.2)
  "issued_at_height"?: number,              // H₀, when the reviewer gave it
  "disclosed": [string],                    // what the holder gave up by handing this over
  "does_not_prove": [string]                // §1's non-goals
}
```

CLI exit codes:
- 0: `all_verified`, and `assurance` is `verified_with_control` or `verified_history_only`;
- 4: `all_verified`, but `assurance` is `consistent_offline` or `verified_partly_explained`: read the report before relying on it;
- 1: a claim is `failed` or `unproven`, a problem was reported, or the dossier did not parse;
- 2: otherwise, some claim is `not_checked` (check again later, or supply the missing transaction);
- 3: an I/O or node error other than "not found", with no report.

`shielded_actions` counts actions, and each action carries a nullifier, real or dummy, so it is a count of *possible* spends. The report carries every note's nullifier: whoever holds the report can recognise those notes' future spends (§8).

`controlled` is true only when a control claim verified **and** the reviewer gave the nonce they expected: without it, an old dossier answering an old nonce would read as control now (vector `real_without_expected_nonce`: every claim verified, `controlled` false). An expected nonce that no control claim answers is a problem, so `all_verified` is false (vector `no_control_claim_with_expect_nonce`).

`assurance` is the one word a case file needs, the first of these that applies:
1. `not_verified`: not `all_verified`;
2. `consistent_offline`: every claim holds against the transactions supplied, but not all of them came from a node with a height (`anchored` false). A holder can hand over fabricated files (§9), so this is consistency, not verification against the chain;
3. `verified_partly_explained`: some payment's or control's funding notes are `untraced`, an origin is in `unexplained_origins`, `undisclosed_input_min_zat` is above 0, or `unvalued_inputs` is above 0 (§5.6);
4. `verified_history_only`: explained, but not `controlled` (nothing shows the holder can spend the funds now);
5. `verified_with_control`: all of the above hold.

### 5.6 Trace closure and value coverage

Each claim is checked on its own. A source-of-funds reviewer also needs the claims to add up:
- **Trace closure.** The traced notes are the origin claims' notes, plus the `to` of every verified path whose `from` is traced (to a fixpoint). Every note in a `deposit`'s or `transparent_payment`'s `funded_by`, and in a `control`'s `spent`, that is not traced is listed in `untraced`. A dossier of a control claim alone (vector `control_only`), or one with a path removed (vector `unlinked_payment`), verifies claim by claim and is `verified_partly_explained`.
- **Origins that name a source.** An origin explains its funds only when its transaction shows where they came from: transparent inputs whose addresses are read from the spent outputs, no disclosed note spent (that would be a hop, which a path states), and no undisclosed shielded money. The check is the value bound below applied to the origin's transaction. Any other verified origin is listed in `unexplained_origins`, with a detail saying why. Declaring the holder's own change an origin therefore launders nothing (vector `origin_laundering`), and neither does a faucet's or a mixer's shielded payment. The faucet sample's n1 is listed, and the exchange sample's origin, paid by the hot wallet's transparent input, is explained.
- **Value coverage.** For the transaction of each verified path, deposit, transparent payment and control claim, and for each Orchard-family pool P, the notes it spent in P are worth the notes it created in P plus P's value balance (value leaving the pool, public in the transaction). Of those, the dossier discloses the notes created (and the receipts' outputs, when not also disclosed as notes) and the disclosed notes spent there. So it spent at least max(0, created + receipts + balance − disclosed spent) in P from notes the dossier does not disclose, and at least max(0, Sapling's value balance) from Sapling notes. When the sum is above 0, the claim carries `undisclosed_input_min_zat` and the detail "T also spent at least X from notes this dossier does not disclose". The report sums it once per transaction. Transparent inputs of these transactions are money the disclosed notes do not explain either: their value, read from the spent outputs when the previous transactions are supplied (`prevout_txids` returns them for every transaction the dossier names), is added to the bound, and inputs whose value is unknown are counted in `unvalued_inputs`. So a large deposit "funded by" a small clean note reads as what it is: mostly undisclosed money (vector `history_without_its_origin`: 1 TAZ). The bound is a lower bound; a holder who hides a change note lowers it only down to what the payment and the pool balance force.

## 6. Building

### 6.1 Finding the transactions

The holder names the transactions to explain, in any order (§6.2 orders them). Alternatively, `zeceipt dossier scan --from <height>` (or `build --scan-from`) streams compact blocks from the node and runs trial decryption on every Orchard-family action with the UFVK's incoming viewing keys (both ZIP 32 scopes). Compact decryption opens the first 52 bytes of the plaintext, which hold the value and rseed, so each found note's nullifier is known without the full transaction. A later action carrying one of those nullifiers marks a spend. The scan sees only notes received at or after `--from`: a spend of a note received earlier is found only if the scan starts before that note arrived. `the_scanner_finds_exactly_the_holders_transactions` checks it on the testnet transactions (`6d35571`). A node serving compact blocks learns the scanned range; fetching the found transactions by txid tells it which ones they are (§8.4).

### 6.2 Assembling the claims

Input: the UFVK (its Orchard full viewing key; it never leaves the machine), the transactions, and optionally the challenge transaction with its nonce. `nk` is bytes 32..64 of the raw Orchard FVK. The transactions are first put in spend order: each comes after every other listed transaction that created a note it spends, and otherwise the given order is kept (`spend_order`). Otherwise a spend listed before the note's creation would read as a new origin. Then, for each transaction in order:
1. `spent` = the notes disclosed so far whose nullifier (§3) is in it.
2. `created` = every Orchard-family note in it that the UFVK's incoming viewing keys open (received, external scope; change, internal scope). Each is disclosed with its `zdp:1:` opening, checked before use. Notes the holder *sent* are not disclosed as notes.
3. If `spent` is empty: an `origin` claim for each created note.
4. Else: a `path` claim from each spent note to each created note; a `deposit` claim, with a receipt-v0 receipt (unsigned, no challenge, change excluded), for every shielded output the holder paid to someone else; and a `transparent_payment` claim for every transparent output; each with `funded_by` = `spent`.
5. The challenge transaction instead discloses only the created notes whose memo contains the nonce. It must pay the holder one such note (`reply`) and spend at least one disclosed note, else the build fails. It gets one `control` claim.

The result is validated (§2) before it is returned. `the_builder_reproduces_the_dossier_from_the_holders_ufvk` rebuilds the committed testnet dossier byte for byte in its notes, receipts and claims, and `a_payment_to_a_transparent_address_is_claimed_and_its_return_is_linked` does the same for the second one, from the transactions listed out of order.

What gets disclosed, and what the holder controls:
- **Every** note the account received or got as change in a listed transaction, and **every** payment it made from disclosed notes, with recipient, value and memo. The holder chooses by listing transactions. A holder may delete claims and notes by hand afterwards, and the dossier stays valid as long as every id a claim names remains.
- **In the challenge transaction, only the reply note.** Its change is not disclosed, so the reviewer, who holds `nk`, cannot compute the change's nullifier and follow the funds further (vector `real`: one note of `10e941e7…` is disclosed, of its two actions).
- A transparent output the holder pays to their own transparent address is claimed like any other (the builder cannot tell), and shielding it back is an origin that names that claim (§5.3).

## 7. The control challenge

### 7.1 Protocol

1. **Reviewer.** Makes a fresh, unpredictable nonce for this case: `zeceipt dossier nonce` prints `zeceipt-challenge-` plus 16 random bytes (hex) from the OS generator; `--json` adds the chain tip height at that moment, H₀, and the time (`POST /v1/nonces` and the case page do the same). The reviewer records both with the case and sends the nonce to the holder. Freshness is the reviewer's job. Never reuse a nonce across cases or holders.
2. **Holder.** From the wallet that holds the funds, sends a small amount **to their own address** with the nonce as the memo, and waits for it to be mined. The claim covers the notes this transaction **spends**, not the amount sent: a wallet that selects one note proves one note, and sending the whole balance to oneself spends every note. The cost is one transaction fee (ZIP 317; 10,000 zatoshi for two actions).
3. **Holder.** Builds with `--control-txid <txid> --nonce <nonce>`, listing before it the transactions that created the notes it spends.
4. **Reviewer.** Verifies with the nonce they issued and H₀: `zeceipt dossier verify --expect-nonce <nonce> --issued-at-height <H₀>` or `checkDossier(text, { expectNonce, issuedAtHeight })`. A control claim answering any other nonce, or mined below H₀, fails, and a dossier with no control claim reports a problem (§5.5). The case is `assurance: verified_with_control` only then.

### 7.2 What it proves

A mined transaction at height H ≥ H₀ spent the listed notes and wrote the reviewer's nonce into an output's memo. The nonce was unpredictable before it was issued, and the memo is bound by the transaction's spend authorization signatures (they sign the sighash, which covers every output). So **someone with spend authority over those notes acted after the nonce was issued**, and controlled at least their value (`value_zat`) at height H.

What it does not prove:
- **Funds now.** The challenge transaction moved them. Their value now sits in the reply note and an undisclosed change note, which are not shown to be the holder's (§3.3), minus the fee. Nothing is proven after H.
- **Who is presenting.** A holder who does not control the funds can relay the nonce to whoever does and present that party's dossier. This is relaying, as with any challenge-response without an identity binding. A payment to the deposit address the reviewer assigned this customer ties the account to the customer's deposit, which is the reviewer's strongest cross-check. The reviewer gives it (`--expect-deposit-address`, HTTP `expect_deposit_address`, JS `expectDepositAddress`; transparent, TEX or unified), and the report sets `deposit_address_paid`. When no verified deposit or transparent payment pays it, that is a problem, and so is an address of another network (vectors `exchange_deposit_address*`, `exchange_other_deposit_address`, `exchange_mainnet_deposit_address`).
- **Freshness without an expected nonce.** The verifier checks the memo against the nonce written in the dossier. Without `--expect-nonce`, an old dossier with an old nonce still has a verified control claim, but `controlled` is false and the assurance is `verified_history_only`; a detail asks the reviewer to check N. With the expected nonce given, it fails (vector `replayed_control`).

### 7.3 Relation to signatures

ZIP 311 would prove spend authority with off-chain spend authorization signatures over a message. For Orchard, an address-signing ZIP is only a draft (forum topic 53971, 2025-12-23), and there is none for Ironwood (`raw/pivot-1001/zcash-demand.md` §2.2). The control challenge gets the same assurance from an on-chain spend. The costs are a fee, a public transaction linkable by the reviewer, and waiting for a block. Two off-chain routes could replace the fee and the block in a v2:
- **A fully proven, unbroadcast transaction** that spends the listed notes, with the nonce in an output memo. Its proofs and spend authorization signatures show the holder can spend those notes now, against the current anchor. Nobody needs to mine it, and the reviewer checks that its nullifiers are not yet on chain. That is the same statement as the v1 control claim, with no fee and nothing published.
- **Signatures by the spend authorizing key**, as ZIP 311 drafts them, and as zally's nonstandard Ironwood profile does today (`ZallyIronwood`, `gustavovalverde/zally`, `crates/zcash-payment-disclosure`, profile byte `0x02`; [R140] in `docs/product/10_research_log.md`). Each signature binds a txid and a message, and is checked against an already-mined action's `rk`. That proves **possession of the key** that authorized a past spend, not that the holder can spend the funds now: those notes are already spent. So it is a key-possession claim, and a different one from control.

v1 keeps the on-chain spend because any wallet can make one today.

### 7.4 Beacon nonces: freshness with no one to issue the nonce

A reviewer-issued nonce is only as fresh as the reviewer says. A **beacon nonce** is `zeceipt-beacon-<H>-<hash of block H, display hex>` (`zeceipt dossier nonce --beacon` prints one for the chain tip). Nobody can know block H's hash before H is mined, and any verifier can look it up after. So a control claim answering it shows that the challenge was made after block H, with no reviewer to trust and no message to exchange: a holder can prove control unprompted, and anyone can check when.

Verification, with no expected nonce given:
1. Look up block H's hash and time from a trusted node (`beacon_heights`; CLI and `checkDossier` do it online).
2. Not looked up: the control is `not_checked` (vector `beacon_not_looked_up`). Another hash: `failed` (vector `beacon_wrong_hash`).
3. Otherwise, the challenge transaction must be mined above H, as with an issue height H₀ = H + 1. Without its height (files), the control is `not_checked` (vector `beacon_from_files`).
4. When it verifies, `controlled` is true and `beacon_height` is H. The details name the block and its time, and the reviewer judges whether H is recent enough for the case (vector `beacon`; PROOF §10).

A reviewer who gives an expected nonce overrides the beacon: the claim must answer theirs.

## 8. Privacy

### 8.1 What each disclosure reveals, and to whom

| Disclosed | Reveals | To |
|---|---|---|
| A note opening | That note's transaction, value, receiver (a diversified address of the holder, external or internal scope) and memo, including a sender's memo text (the faucet's request id in the testnet dossier) | Anyone holding the dossier or the report |
| A receipt | One payment's recipient address, value and memo | Same |
| `nk` with the openings | Each disclosed note's nullifier, so **when and in which transaction each disclosed note is spent**, past and future, including notes the dossier shows unspent (n5 to n9 in the testnet dossier) | Anyone holding the dossier. The report lists the nullifiers themselves, so anyone holding the report too |
| `nk` with any **other** opening of the account | That note's nullifier, so when it is spent. Every sender of a note to this account knows its opening | Any past or future sender who obtains `nk`: a reviewer who also paid the holder (an exchange that processed a withdrawal to this shielded address, the realistic case), or anyone the dossier leaks to |
| The set of txids | That these transactions belong together | The node the verifier (and builder) fetches them from (§8.4) |

`nk` does **not** reveal: other notes' contents, incoming or outgoing viewing capability, addresses beyond those in the openings, balances, or spending ability (§3.2). Nobody can compute the nullifier of a note whose opening they do not know.

### 8.2 Address linkability

Openings show receivers. In the testnet dossier, the seven notes the holder paid itself in the INV-T transactions (n2 to n8) share one address, and the faucet note and the reply share another. Anything else the reviewer sees for those addresses (another dossier, a receipt, a delivery proof) links to this holder. As receipt-v0 §9 recommends, give each payer a fresh diversified address.

### 8.3 Permanence

Disclosure cannot be revoked. `nk` is fixed for the life of the account, and the dossier and the report are bearer documents.

### 8.4 Public nodes

Verifying fetches every transaction the dossier names, then the previous transactions of the origins' transparent inputs; building fetches every transaction it explains. A public node (the CLI's `testnet.zec.rocks`/`zec.rocks`; the browser's `zjs.zec.rocks` or ChainSafe, which proxies to it) learns that one client asked for this set of txids together, which links them. It learns no opening and no `nk`. Mitigations: `--endpoint` for the party's own node (CLI), `useNodes` (JS) or a self-hosted copy of the pages built with `scripts/build_site.sh --node` (whose CSP allows only that node), and `--raw-tx-dir`, `{ txs }` or the case page's transaction files offline. Verifying by block range, without naming txids, is not implemented.

### 8.5 Recommendations

- Read the memos before sharing: received memos are disclosed verbatim.
- List only the transactions the case needs. Delete any claim and note the reviewer did not ask for.
- Treat the dossier and the report as confidential case material. A reviewer should not attach the report to anything wider than the case.
- After the case, move the remaining funds to a **new account** (a new ZIP 32 account index, whose `nk` was never disclosed). The reviewer will see that spend of the disclosed notes, and nothing after it.
- A reviewer who also sends to customers' shielded addresses (withdrawals) can track those notes' spends with a disclosed `nk`. That is a reason for the holder to prefer the fresh-account step above.

## 9. Security considerations

Test names are in `crates/zeceipt-core/tests/dossier.rs` unless another file is named; vectors are in `spec/test-vectors/dossier-v1.json`.

| Attack | Result | Covered by |
|---|---|---|
| **Forged note**: an opening with any byte changed (value, rseed, receiver, action, pool, txid) | The note does not open, and every claim naming it fails | `crates/zeceipt-core/tests/delivery.rs` `tampered_proofs_and_transactions_fail_closed`; vector `forged_note_value` |
| **Wrong `nk`** | Every nullifier claim fails; the origin is `unproven`; `nk_proven` is false | `a_wrong_nk_fails_every_claim_that_tests_a_nullifier_and_only_those`; vector `wrong_nk` |
| **Invalid `nk`** (not a key encoding) | Reported once in `problems`; every nullifier claim fails "nk is not a valid key" | `the_fixes_of_the_spec_review_hold`; vector `invalid_nk` |
| **Replayed control** (an old dossier, an old nonce) | With the expected nonce, `failed`: "not the one you issued". A claim naming the new nonce over an old reply fails: "does not carry the nonce" | `the_fixes_of_the_spec_review_hold`; `a_wrong_nonce_a_foreign_note_or_a_missing_transaction_fails`; vectors `replayed_control`, `nonce_mismatch`. Without an expected nonce, `controlled` is false and the assurance is history only (`real_without_expected_nonce`) |
| **A challenge made before the nonce was issued** (a leaked or guessed nonce, a pre-made transaction) | With H₀, `failed`: "mined at height H, before you issued the nonce" | `a_control_mined_before_the_nonce_was_issued_fails`; vectors `control_before_issue`, `control_after_issue` |
| **Someone else's notes** | Path, deposit and control fail: under this `nk`, another account's note has a nullifier no transaction carries. An origin on such a note is `unproven`, "Nothing here shows n10 is the holder's". A key that sees nothing builds nothing | `another_holders_key_cannot_build_a_dossier_for_these_funds`; `the_fixes_of_the_spec_review_hold`; vectors `control_foreign_note`, `path_from_foreign_note`, `origin_of_a_sent_note` |
| **A path to a foreign note** (a `to` created by a transaction that did not spend `from`) | `failed`: "not among … spends" | `a_wrong_nonce_…` (n1→n6); vector `path_to_note_of_another_tx` |
| **A deposit not funded by the listed notes** | `failed`: "Receipt r1 opens a payment of … but not from n2" | `a_wrong_nonce_…`; vector `deposit_not_funded_by` |
| **A control that over-claims** (a note the challenge did not spend) | `failed`: "does not spend n1" | `a_wrong_nonce_…`; vector `control_overclaims_spent` |
| **Someone else's transparent payment claimed** (an output of a transaction that did not spend the listed notes, or no such output) | `failed`: "but not from n1"; "has no transparent output 7". A claim with no funding note is a parse error | `a_payment_to_a_transparent_address_is_claimed_and_its_return_is_linked`; vectors `transparent_payment_not_funded_by`, `transparent_payment_no_such_output`, `transparent_payment_to_a_shielded_tx`; parse case `transparent_payment_no_funding` |
| **A mislabelled transaction** (bytes of one txid supplied under another) | Set aside, with a problem; the claims that needed the named one are `not_checked` | `the_fixes_of_the_spec_review_hold` |
| **Value inflation by duplicates** (one note twice in a claim, or under two ids) | Parse error | `the_fixes_of_the_spec_review_hold`; parse cases `duplicate_output`, `duplicate_in_claim`, `duplicate_in_funded_by` |
| **Mempool transaction** | Every claim resting on it is `not_checked` until it is mined | `a_wrong_nonce_…` (last case); vectors `control_tx_in_mempool`, `every_tx_in_mempool` |
| **Missing transaction** | The claims that need it are `not_checked`: "not found on the node, or not supplied" (CLI exit 2) | `a_wrong_nonce_…`; vector `control_tx_missing` |
| **Substituted transparent `scriptSig`** in a file or from a hostile node | No effect on the report: funders are read from the previous transaction's output script, which that transaction's txid covers, and which this transaction's prevout names. Without the previous transaction, the address and value are absent | `an_output_script_names_the_address_it_pays` (unit); `a_transparent_origin_names_its_funder_from_the_spent_output` and vector `transparent` on the real deshield/shield pair `52af3e0d…`/`c28b6000…` |
| **Unknown fields, claim types, versions; malformed `nk`, nonce, openings** | Parse error ("unsupported format version" for another dossier or `zdp` version) | `zeceipt-types` `a_dossier_parses_and_refuses_what_it_cannot_be`; `parse_cases` in the vectors |
| **Small clean funds "funding" a large payment** (mixing): a deposit of undisclosed money listing one small disclosed note | The claim holds (that note was spent there), but `undisclosed_input_min_zat` states the rest, and `assurance` is `verified_partly_explained` | vector `history_without_its_origin` |
| **Claims that do not add up**: a control or a payment whose funds no path leads back to an origin | `untraced`; `verified_partly_explained` | vectors `control_only`, `unlinked_payment` |
| **Network relabelling** (`"network": "main"` on a testnet dossier) | Refused by the CLI and the service when a network flag disagrees; offline, `consistent_offline` | `dossier_serve_answers_over_http` |
| **Colluding owner with a key sharing `nk`** | Notes of that key read as this account's (§3.3) | Inherent to v1; stated in the report's scope |
| **Fabricated transaction files** (offline, holder-supplied) | Anything can be shown, since no proof or signature is checked, and the txid covers only the bytes given. Every claim that rests on a file carries "inclusion … was not checked here", and the report is `consistent_offline` (CLI exit 4), never `verified_*` | Inherent to offline mode; verify against a trusted node. Vectors `real`, `issue_height_without_heights` |

Trust assumptions:
- the node or the file source, for inclusion and heights. A v5/v6 txid binds all the effecting data the checks use, including the previous transactions' output scripts, but not inclusion in the chain;
- the reviewer, for nonce freshness;
- the Orchard protocol's assumptions (Poseidon PRF, discrete log on Pallas, Halo 2 soundness) for §3.3.

## 10. Relation to other work

- **receipt-v0.** Deposit claims embed receipt-v0 receipts unchanged, verified per receipt-v0 §4. A dossier adds the link from a payment back to the notes that funded it (`funded_by`, by nullifier).
- **zcash-delivery-proof.** Notes are its `zdp:1:` openings, checked per its `SPEC.md` §4. A dossier adds `nk`-derived nullifiers, which connect one opening to the transaction that spends it, and so chain openings into a history.
- **Exchange deposits.** A deposit to an exchange is usually to a transparent (or TEX, ZIP 320) address, which the exchange already sees on chain. `transparent_payment` gives it what it cannot see: that the deposit was paid from notes whose history the dossier discloses.
- **ZIP 311 (draft).** Its outputs half is receipt-v0. Its spend-authority half (signatures by the spend authorizing key over a message) is what `control` replaces with an on-chain spend (§7.3). The `funded_by` link has no equivalent in ZIP 311: there the sender proves authority over the spends, while a dossier shows that the spends were of disclosed notes.
- **Viewing-key disclosure** (a UFVK, or a UFVK per ZIP 32 period account). A viewing key discloses every note, payment and memo of the account, past and future, and proves no spend authority. A dossier discloses chosen notes, `nk` (spend tracking for those notes, and for any note whose opening the holder of `nk` knows), and a spend.

## 11. Test vectors

- **The real dossiers**:
  - `fixtures/dossier/testnet-dossier.json` (sha256 of the file `7b8d7ecf…9ea9c1`), over five testnet transactions committed as `fixtures/testnet/<txid>.hex`: the faucet payment `90f6a335…2a4b` (4,419,987), the three INV-T payments `fcfde625…7f0b` (4,420,000), `1c49834b…e39d` (4,420,003) and `a2619e39…3df8` (4,420,005), and the challenge `10e941e7…6e43` (4,421,345). The run is `docs/PROOF.md` §8. `crates/zeceipt-core/tests/dossier.rs` checks it offline in CI;
  - `fixtures/dossier/testnet-dossier-transparent-origin.json`: the same funds plus a payment of 0.05 TAZ to the account's transparent address `tm9vh…` (`52af3e0d…105e`, 4,421,678, claim 12, `transparent_payment`) and its shielding back (`c28b6000…cefe`, 4,421,684, claim 13, an origin that names that payment and is `unproven` until its note is spent);
  - `fixtures/dossier/testnet-dossier-exchange.json`: an exchange-deposit review (`docs/PROOF.md` §9). A withdrawal from an exchange's transparent hot wallet `tmPVt…` to the customer (`5146f38c…36e6`, 4,422,279; its funding transaction `773da014…4b0d`, 4,422,275, is the prevout), the customer's deposit to their transparent deposit address `tmXdy…` (`a51d1271…85cf`, 4,422,295), and a control answering the nonce issued at 4,422,294 (`14a9551d…cce6`, 4,422,305). Every claim verifies with control; the holder's UFVK is `fixtures/testnet/holder2-ufvk.txt`.
  - `fixtures/dossier/testnet-dossier-beacon.json`: the same customer's funds, carried on through the earlier challenge `14a9551d…` into a control that answers the beacon of block 4,426,425 (`701df8b1…70ce`, mined at 4,426,430; PROOF §10).
- **`spec/test-vectors/dossier-v1.json`**:
  - `nk`, the filler `ak`, and for each of the nine notes its txid, pool, action, height, value, nullifier and the transaction that spends it. With these, an implementer can check an `nk`-only nullifier derivation against chain data;
  - the real heights of the eleven transactions, for the cases that use them;
  - 45 cases. Each is a patch to one of the real dossiers, plus an expected nonce, an issue height and changes to the transactions supplied, with the expected exit code, `all_verified`, `assurance`, `nk_proven`, `controlled`, statuses, problems, and the summaries of the claims that do not verify;
  - 19 parse cases, each with its expected error (without serde's line and column).

  `crates/zeceipt-core/tests/dossier_vectors.rs` and `packages/verify/test/dossier-vectors.mjs` run all 64 in CI, natively and through the WASM; `ZECEIPT_WRITE_VECTORS=1` on the Rust test rewrites the expectations from the code, for review in the diff.
