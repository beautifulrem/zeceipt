# Zeceipt receipt format v0 (`zeceipt-v0`)

Status: implemented (crates `zeceipt-types`, `zeceipt-core`). This document is normative for v0.

## 1. Purpose

A receipt lets the sender of a shielded Zcash payment disclose **exactly one output** of **one transaction** to anyone, so that the recipient, an auditor, or a public ledger can independently recover that output's recipient address, value and memo from the chain — without receiving a viewing key and without learning anything about the sender's other outputs, balance or history.

The disclosure unit is the per-output **Outgoing Cipher Key (OCK)** defined by the Zcash protocol (`PRF^ock`, spec §4.20). This is the `outputs` half of ZIP 311 (Payment Disclosures). It is **not** a full ZIP 311 disclosure: ZIP 311 additionally requires a spend-authority signature over the disclosure, which needs the spending key. Zeceipt v0 deliberately does not require spending keys; issuer attribution is provided by an application-layer ed25519 signature instead (§5).

## 2. Envelope

JSON object. Unknown fields must be ignored by verifiers.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string | yes | Must be `"zeceipt-v0"`. |
| `network` | `"main"` \| `"test"` | yes | Network the transaction was mined on. Signed. |
| `pool` | `"ironwood"` \| `"orchard"` \| `"sapling"` | yes | Pool of the disclosed output. Signed. |
| `txid` | hex string (64 chars) | yes | Transaction id in display (explorer) byte order. |
| `output_index` | integer ≥ 0 | yes | Index of the action/output inside that pool's bundle. |
| `ock` | base64url (no padding), 32 bytes | yes | The output's Outgoing Cipher Key. |
| `label` | string | no (default `""`) | Issuer-chosen text: invoice id, USD amount, rate, date. Signed. |
| `challenge` | base64url | no | Verifier-supplied challenge (ZIP 311 `msg`). Signed. See §6. |
| `issuer_key_id` | string | no | Key identifier from the issuer's well-known file (§7). Signed. |
| `issuer_pubkey` | hex (64 chars) | no | ed25519 public key of the issuer. |
| `signature` | hex (128 chars) | no | ed25519 signature over the canonical bytes (§5). |
| `zip311_profile` | string | no | Informational; `"outputs-only"` in v0. |

Shareable URL form: `https://<host>/r/<base64url(json)>`. Verifiers accept the URL, the bare base64url payload, or raw JSON.

## 3. Issuance

Inputs: the issuer's outgoing viewing key(s) (derived from a UFVK), the raw transaction.

For each output in the pool bundle:
1. `ock = PRF^ock(ovk, cv, cmx, ephemeralKey)` using the pool's domain (`IronwoodDomain` / `OrchardDomain` / `SaplingDomain`).
2. If `try_output_recovery_with_ovk` succeeds, the output was sent by this key; emit a receipt with that `ock`.
3. Change outputs (internal scope OVK) are skipped unless explicitly requested.

## 4. Verification

Given a receipt, the raw transaction bytes, and the expected challenge (empty if none):
1. Parse the transaction; compute its txid; **reject** if it differs from `txid`.
2. If the receipt carries a `signature`, verify it over the canonical bytes with the inline `issuer_pubkey`; **reject** on failure. Unsigned receipts are accepted only if the caller allows it.
3. **Reject** if the bound challenge differs from the expected challenge.
4. Select the output by (`pool`, `output_index`); **reject** if out of range.
5. `try_output_recovery_with_ock(domain, ock, output, out_ciphertext)`; **reject** if it returns nothing.
6. Report: recipient address, value (zatoshi), memo, txid, pool, index, confirmations (from the data source), issuer public key if signed.

There is no partial success. Any failure is "invalid"; a transaction that cannot be found is "pending", never "invalid".

### What verification proves
- The named transaction contains an output that pays `value` to `recipient` with `memo`, and whoever produced the receipt knew that output's OCK (which requires the sender's OVK).

### What it does not prove
- That the person **showing** the receipt is the sender or the recipient (use a challenge, §6, for interactive proofs).
- Anything about other outputs of the same transaction, other transactions, or balances.
- Spend authority (full ZIP 311). This is a roadmap item.

## 5. Canonical signing bytes

```
"zeceipt-v0" || network (1 byte: 0x00 main, 0x01 test) || pool (1 byte: 0x00 ironwood, 0x01 orchard, 0x02 sapling)
            || txid (32 bytes, display order) || output_index (u32 LE) || ock (32 bytes)
            || len(label) (u32 LE) || label (UTF-8) || len(challenge) (u32 LE) || challenge
            || len(issuer_key_id) (u32 LE) || issuer_key_id (UTF-8, empty if absent)
```
Every field that influences what a verifier displays is covered; only `issuer_pubkey`, `signature` and `zip311_profile` are outside the signed string. Deterministic vectors: `spec/test-vectors/receipt-v0.json`.
Signature: ed25519 (RFC 8032) over these bytes. The signature attests that the holder of `issuer_pubkey` produced this envelope; binding that key to an organisation is §7.

## 6. Challenges (directed receipts)

A verifier who wants assurance that a receipt was produced *for them* sends a random challenge; the issuer binds it into `challenge` before signing. The verifier must re-supply the challenge; mismatch is rejected. A receipt without a challenge is a bearer document: anyone holding it can verify it and forward it.

## 7. Issuer key binding (optional, upgrade-only)

An organisation may publish `https://<org-domain>/.well-known/zeceipt.json` (signed by a root key) listing key ids, public keys and validity intervals. A verifier that looks it up may upgrade "signed by key X" to "key X was bound to org Y during interval T". Failure to look up, a lapsed domain, or a key outside every interval yields **"cryptographically valid, issuer binding unknown"** — never "invalid".

## 8. Audit packs

`{"version":"zeceipt-v0","title":…,"declared_total_zat":…,"receipts":[…]}`. Verifiers verify each receipt and sum recovered values. The sum is a **lower bound** on what the issuer paid; a pack cannot prove completeness.

## 9. Privacy notes

- Disclosing an OCK reveals that output's diversified address; repeated receipts to the same address are linkable. Issuers should pay each recipient at a fresh diversified address.
- Disclosure is permanent; there is no revocation.
- Hosted verifiers request the txid from a public node; a CLI can fetch by block range or over Tor.

## 10. Pools and transaction versions

| pool | tx version | note plaintext lead byte | domain |
|---|---|---|---|
| ironwood | v6 (NU6.3+) | 0x03 | `IronwoodDomain` |
| orchard | v5/v6 | 0x02 | `OrchardDomain` (pool sealed 2026-07-28; historical receipts only) |
| sapling | v4+ | 0x01/0x02 | `SaplingDomain` with `Zip212Enforcement::GracePeriod` (both lead bytes accepted; the note commitment binds the plaintext) |
