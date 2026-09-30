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
| `network` | `"main"` \| `"test"` \| `"regtest"` | yes | Network the transaction was mined on. Signed. (`regtest` is for local development chains.) |
| `pool` | `"ironwood"` \| `"orchard"` \| `"sapling"` | yes | Pool of the disclosed output. Signed. |
| `txid` | hex string (64 chars) | yes | Transaction id in display (explorer) byte order. |
| `output_index` | integer ≥ 0 | yes | Index of the action/output inside that pool's bundle. |
| `ock` | base64url (no padding), 32 bytes | yes | The output's Outgoing Cipher Key. |
| `label` | string | no (default `""`) | Issuer-chosen text: invoice id, USD amount, rate, date. Signed. |
| `challenge` | base64url | no | Verifier-supplied challenge (ZIP 311 `msg`). Signed. See §6. |
| `issuer_key_id` | string | no | Key identifier; `<label>@<domain>` claims a domain whose well-known file may bind the key (§7). Signed. |
| `issuer_pubkey` | hex (64 chars) | no | ed25519 public key of the issuer. |
| `signature` | hex (128 chars) | no | ed25519 signature over the canonical bytes (§5). |
| `zip311_profile` | string | no | Informational; `"outputs-only"` in v0. |

### 2.1 Shareable URL

Form: `https://<host>/r#<payload>`, where `<payload>` is the base64url (no padding) encoding of the receipt JSON. A trailing `/` on the host is dropped.

The payload is in the **fragment** because it contains the OCK: whoever holds the link can read that output. A browser never sends the fragment to the host ("the fragment identifier is separated from the rest of the URI prior to a dereference", RFC 3986 §3.5), and never puts it in a `Referer` (Referrer Policy, "strip url for use as a referrer", step 5). So the host serving the receipt page, its CDN and its access logs never see the OCK. ZIP 324 carries its payment key in the fragment for the same reason. The link is still a bearer capability: anyone it is forwarded to can verify the payment.

The fragment is the bare payload, not `key=value` pairs: the receipt is one self-describing document with its own `version`. Nothing else belongs in the link. In particular the verifier types the challenge they sent (§6); it is never taken from the link, because a link carrying it would prove nothing about who presents it.

Verifiers accept a URL, a bare payload, or raw JSON. Rule, in order:

1. After trimming whitespace, input starting with `{` is raw JSON.
2. If the input contains `#` and the text after the first `#` is not empty, that text is the payload. This covers the URL form under any host or path prefix, and `#<payload>` (what a browser's `location.hash` returns).
3. Otherwise, in the text before any `#`: if it contains `/r/`, the payload is the text after the last `/r/`, up to any `?`. This is the path form `https://<host>/r/<payload>` that v0 issuers emitted before 2026-09-23; it is accepted, not emitted, because its payload reaches the host.
4. Otherwise the text before any `#` is the bare payload.

Text after the payload in the fragment (`#<payload>&k=v`, `#<payload>?x`, a second `#`) is not stripped: the fragment must be exactly the payload, and anything else is refused. An empty payload, or one that is not base64url of a receipt JSON, is an error ("URL does not contain a receipt payload"). `spec/test-vectors/receipt-v0.json` → `url_forms` gives one vector's link in both forms.

## 3. Issuance

Inputs: the issuer's outgoing viewing key(s) (derived from a UFVK), the raw transaction.

For each output in the pool bundle:
1. `ock = PRF^ock(ovk, cv, cmx, ephemeralKey)` using the pool's domain (`IronwoodDomain` / `OrchardDomain` / `SaplingDomain`).
2. If `try_output_recovery_with_ovk` succeeds, the output was sent by this key; emit a receipt with that `ock`.
3. Change outputs are skipped unless explicitly requested. An output is change when its recovered recipient is an address of the issuer's own full viewing key, in either ZIP 32 scope. Which OVK opened it is not a signal: wallets differ (one encrypts change with the external OVK, another with a key the UFVK does not expose; `docs/PROOF.md` §5b). With a bare OVK, change cannot be recognised, and every opened output is issued.

## 4. Verification

Given a receipt, the raw transaction bytes, and the expected challenge (empty if none):
1. Parse the transaction; compute its txid; **reject** if it differs from `txid`.
2. If the receipt carries a `signature`, verify it over the canonical bytes with the inline `issuer_pubkey`; **reject** on failure. Unsigned receipts are accepted only if the caller allows it.
3. **Reject** if the bound challenge differs from the expected challenge.
4. Select the output by (`pool`, `output_index`); **reject** if out of range.
5. `try_output_recovery_with_ock(domain, ock, output, out_ciphertext)`; **reject** if it returns nothing, or if the recovered value is above `MAX_MONEY` (2.1 × 10¹⁵ zatoshi), which no valid transaction can carry. The protocol specification types Sprout and Sapling note values as {0 .. MAX_MONEY}; its Orchard-like note type (Orchard, Ironwood) allows 64 bits, but a sender selects each Action's value in {0 .. MAX_MONEY}, and a note is funded from a pool whose balance cannot go negative (ZIP 209) out of a total supply that cannot exceed `MAX_MONEY`. Issuers apply the same check.
6. Report: recipient address, value (zatoshi), memo, txid, pool, index, confirmations (from the data source), issuer public key if signed.

There is no partial success. Any failure is "invalid"; a transaction that cannot be found is "pending", never "invalid".

For **unsigned** receipts every field, including `network`, is caller-controlled and therefore advisory; a verifier that knows which network it is operating on must reject a receipt whose `network` contradicts it (the CLI does this when `--testnet` is given explicitly).

### What verification proves
- The named transaction contains an output that pays `value` to `recipient` with `memo`, and whoever produced the receipt knew that output's OCK. Deriving an OCK takes the sender's OVK, but an OCK is also inside every receipt for that output, so anyone holding an earlier receipt knows it too. A signature attributes the envelope to a key, not the OCK to its sender.

### What it does not prove
- That the person **showing** the receipt is the sender or the recipient (use a challenge, §6, for interactive proofs).
- That the output is **still unspent**, or that whoever presents the receipt can spend it (a receipt carries no spending ability): a receipt shows that a payment was made, not what happened to the note since. Monero's payment proofs carry the same warning ("do not guarantee that funds associated with a proof are spendable").
- Anything about other outputs of the same transaction, other transactions, or balances.
- Spend authority (full ZIP 311). This is a roadmap item.

## 5. Canonical signing bytes

```
"zeceipt-v0" || network (1 byte: 0x00 main, 0x01 test, 0x02 regtest) || pool (1 byte: 0x00 ironwood, 0x01 orchard, 0x02 sapling)
            || txid (32 bytes, display order) || output_index (u32 LE) || ock (32 bytes)
            || len(label) (u32 LE) || label (UTF-8) || len(challenge) (u32 LE) || challenge
            || len(issuer_key_id) (u32 LE) || issuer_key_id (UTF-8, empty if absent)
```
An absent `issuer_key_id` is encoded identically to an empty one (length 0). Every field that influences what a verifier displays is covered; only `issuer_pubkey`, `signature` and `zip311_profile` are outside the signed string. Deterministic vectors: `spec/test-vectors/receipt-v0.json`.
Signature: ed25519 (RFC 8032) over these bytes. The signature attests that the holder of `issuer_pubkey` produced this envelope; binding that key to an organisation is §7.

## 6. Challenges (directed receipts)

A verifier who wants assurance that a receipt was produced *for them* sends a random challenge; the issuer binds it into `challenge` before signing. The verifier must re-supply the challenge; mismatch is rejected. A receipt without a challenge is a bearer document: anyone holding it can verify it and forward it.

A challenge counts only on a **signed** receipt, and only as far as the signing key does. An unsigned envelope is caller-controlled (§4), so anyone who holds an earlier receipt for the output (and so its OCK) can write any challenge into one: a verifier reports `challenge_checked` false for an unsigned receipt even when its challenge matches, and issuers refuse to bind a challenge without signing. On a signed receipt, a matching challenge shows that the holder of `issuer_pubkey` made the envelope after the challenge was sent; which organisation that is remains §7's question.

## 7. Issuer key binding (optional, upgrade-only)

A signature proves only "made with key K". An organisation binds its keys to a domain it controls by serving a file on that domain over HTTPS. Control of the domain is the binding, as in Nostr's NIP-05, W3C `did:web` and AT Protocol handles. There is no separate root key: a key the verifier does not already know would bind nothing.

**The claim.** A receipt claims a domain through its signed `issuer_key_id`, written `<label>@<domain>`, for example `2026-09@pay.example.org`, as NIP-05 writes `name@domain`.
- `<label>` is 1–64 characters of `A-Z a-z 0-9 . _ -`.
- `<domain>` is an ASCII DNS name in LDH form, and nothing else:
  - lowercase `a-z`, `0-9` and `-`;
  - labels of 1–63 characters that neither start nor end with `-`;
  - at least one dot and at most 253 characters;
  - no trailing dot, no port and no IP literal (its last label is not all digits).

  An internationalised name appears only as its `xn--` A-label. Verifiers look up and display the domain exactly as written, never decoded to Unicode, so a lookalike cannot hide behind a script mix-up.
- The key id is signed (§5), so the claimed domain cannot be changed without breaking the signature.
- A key id without `@`, or with a domain outside this form (for example non-ASCII), claims no domain. Its binding is unknown, and it is never looked up.

**The file** is `https://<domain>/.well-known/zeceipt.json`:

```json
{
  "version": "zeceipt-v0",
  "keys": [
    { "key_id": "2026-09@pay.example.org", "pubkey": "<64 hex: ed25519>", "note": "optional, shown as text" }
  ]
}
```

- Every `key_id` in the file ends in `@<the file's own domain>`. Entries for any other domain are ignored: a file vouches for its own domain only.
- To retire a key without disowning past receipts, keep it listed; the `note` can say so.
- To disown a key, for example after a compromise, remove it.

**The lookup.** A verifier looks up a binding only when its user asks, because the lookup tells the domain that one of its receipts is being checked. It fetches the file with a GET over HTTPS on the default port.
- It follows no redirects (NIP-05: "Fetchers MUST ignore any HTTP redirects").
- It reads at most 64 KiB and gives up after 10 seconds.
- A server that wants browser verifiers to see its file sends `Access-Control-Allow-Origin: *`.

**The outcome:**
- **Confirmed.** The file lists an entry whose `key_id` and `pubkey` both equal the receipt's: "key K is listed by <domain>". That means the domain vouches for the key now. It does not date the vouching to when the receipt was made.
- **Not listed.** The domain answered with a valid file that has no such entry: "<domain> does not list this key".
- **Unknown.** Anything else: no `@` in the key id, a network error, a status other than 200, a redirect, an oversize or malformed file, or a browser refusing the response.

None of these changes whether the receipt is cryptographically valid: a binding is never a reason to call a receipt "invalid".

## 8. Audit packs

`{"version":"zeceipt-v0","title":…,"declared_total_zat":…,"receipts":[…]}`. Verifiers verify each receipt and sum recovered values, **counting each output (txid, pool, output index) once**: a receipt listed twice, or two receipts for one output, would otherwise double it. The sum is a **lower bound** on what the issuer paid; a pack cannot prove completeness.

## 9. Privacy notes

- Disclosing an OCK reveals that output's diversified address; repeated receipts to the same address are linkable. Issuers should pay each recipient at a fresh diversified address.
- Disclosure is permanent; there is no revocation.
- Hosted verifiers request the txid from a public node. A CLI can instead use a self-hosted node (`--endpoint`) or a raw transaction file, offline (`--raw-tx-file`). Fetching by block range or over Tor is planned, not implemented.

## 10. Pools and transaction versions

| pool | tx version | note plaintext lead byte | domain |
|---|---|---|---|
| ironwood | v6 (NU6.3+) | 0x03 | `IronwoodDomain` |
| orchard | v5/v6 | 0x02 | `OrchardDomain` (pool sealed 2026-07-28; historical receipts only) |
| sapling | v4+ | 0x01/0x02 | `SaplingDomain` with `Zip212Enforcement::GracePeriod` (both lead bytes accepted; the note commitment binds the plaintext) |

## 11. Delivery proofs (`zdp:1:`), accepted alongside receipts

A receipt comes from the sender: its OCK derives from the outgoing viewing key. For the recipient's side, verifiers also accept the delivery proofs of [zcash-delivery-proof](https://github.com/saplingcash/zcash-delivery-proof) (its `SPEC.md`, version 1): `zdp:1:` then 118 bytes in base64url. The bytes are the txid, the pool (Orchard or Ironwood), the action index, the receiver, the value and the rseed. A proof is checked exactly as that specification's §4 says. A verifier recognises one by its `zdp:` prefix, refuses another version by name, and reports it with `kind: "delivery-proof"` beside the same recovered fields as a receipt.

Its guarantees are that specification's, not this one's:
- It is unsigned and takes no challenge, so §5–§7 do not apply to it: a verifier asked to require a signature or a challenge refuses it.
- It names no network: a verifier chooses one to write the recipient, and a page that fetches the transaction asks mainnet, then testnet.
- Like a receipt's OCK, it is known to whoever made it (the recipient with an incoming viewing key, or the sender with an outgoing one) and to anyone holding an earlier copy of it.

`zeceipt prove-delivery` makes such proofs from a UFVK: trial decryption of each Orchard and Ironwood action's `enc_ciphertext` with the incoming viewing keys of both ZIP 32 scopes (received), then recovery from `out_ciphertext` with the outgoing ones (sent). It checks every proof before printing it, and its output for that project's constructed vectors is byte-identical to theirs.

Every verification also reports the transaction's ZIP 239 `wtxid`, which, unlike a v5/v6 txid, covers the proofs and signatures.
