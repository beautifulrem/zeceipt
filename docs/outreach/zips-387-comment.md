<!--
DRAFT, not posted (WBS 3.3.3.4, REQ-INT-4; slice Z1). Posting is the user's decision: a public comment on
https://github.com/zcash/zips/issues/387 (ZIP 311, Zcash Payment Disclosures).
Prerequisite: push the repository (WBS 4.1.1.1), then replace every `[after the push]` with the public link.
Every claim is backed by the evidence named in `.trellis/tasks/09-26-zips-387-draft/implement.md`.
-->

**An implementation report on the outputs half of ZIP 311, and a question about requiring spend authority**

We built an open-source receipt format for disclosing one shielded output: Zeceipt `receipt-v0` [after the push]. It uses the same disclosure unit as ZIP 311's outputs: the per-output OCK (`PRF^ock`, protocol spec §4.20). We are posting it here for two reasons. The ZIP's reference implementation is still marked TBD, and we deliberately made the one choice the ZIP rules out, so the reasoning should be in the open.

**What exists**

- **The format.** One receipt discloses one output of one transaction: network, pool, txid, output index, OCK, a free-text label, and optionally a verifier's challenge. These are signed by the issuer with ed25519 over canonical bytes, with deterministic test vectors (`spec/test-vectors/receipt-v0.json`) [after the push].
- **Verification.** It recovers the note from the transaction's `out_ciphertext` and `enc_ciphertext` with the OCK (`zcash_note_encryption`'s `try_output_recovery_with_ock`, which checks the recovered note against its commitment). It then reports the recipient address, value and memo, and fails closed at a named stage. The same Rust code runs in a CLI and, through WASM, in the browser.
- **Pools:** Ironwood outputs of v6 transactions, and Orchard and Sapling (tested against the official Orchard note-encryption vectors and round trips).
- **Evidence.** A consensus-valid v6 Ironwood transaction on a Zebra regtest chain, issued from the sender's UFVK and verified over gRPC and offline. Real mainnet v6 transactions have been parsed and fetched only.

**How it maps to ZIP 311**

| ZIP 311 | receipt-v0 |
|---|---|
| Output disclosure by OCK | The same |
| `msg` (a verifier's challenge) | `challenge`, signed. A receipt without one is a bearer document, and the verifier is told so |
| Spend-authority signature over the disclosure | **Not required.** Instead, an optional ed25519 signature by an issuer key over all displayed fields |
| — | An optional issuer key binding: a domain vouches for the key at `https://<domain>/.well-known/zeceipt.json`, as NIP-05 and did:web do. It only upgrades a result, never makes it invalid |

**Why no spend authority, and the ZIP's reason for requiring it**

ZIP 311 requires spend authority for at least one input, because an invalid disclosure could have its signatures stripped and then be shown as valid. We think that concern is real for a format in which a signature is what makes a disclosure "valid". We separated the two claims instead:

1. **The payment fact** (this transaction pays this value to this address with this memo) is proven by recovering the note with the OCK. It needs no signature, and stripping a signature cannot change it.
2. **Attribution** (who made the receipt, and what its label says) comes from the signature. A receipt without one is shown as unsigned: "the label is the sender's unauthenticated text", never as signed. A verifier can require a signature (`--require-signature`). Changing any signed field fails at the signature stage, and re-signing with another key attributes the receipt to that key only.

So stripping does not upgrade anything. It downgrades a signed receipt to an unsigned one, and verifiers display that. What an OCK disclosure cannot prove is spend authority: that the person presenting it controls the sending wallet. We say that plainly to verifiers. The reason for accepting the trade is that payroll and grant teams, who are our users, can issue receipts from a viewing key without the spending key ever touching the issuing tool.

**Questions for the ZIP authors**

1. Would an **outputs-only profile** be acceptable as an explicit, separately labelled mode of ZIP 311, or in a companion ZIP? It would show attribution by an issuer signature rather than spend authority, and verifiers would display the difference. Or should output disclosures stay out of the standard?
2. If the ZIP moves forward, we would align our field names and encoding with it, and add a `zip311_profile` value for whatever the ZIP calls this mode. The current receipt already carries an informational `zip311_profile: "outputs-only"`. Are the ZIP's field names settled enough to align with now?
3. Is **Ironwood** in scope for ZIP 311's output disclosures? Our implementation handles Ironwood outputs as the Orchard family under Ironwood's own note-encryption domain version (`IronwoodVersion` in the orchard crate), and it is tested on regtest v6 transactions.

The code, the vectors and the proof log are at [after the push]. We would be glad to change the format to match the ZIP, and to contribute test vectors.
