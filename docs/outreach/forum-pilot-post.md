<!--
DRAFT, not posted (WBS 4.1.2.2; slice L1). Posting is the user's decision: a public action on forum.zcashcommunity.com.
Links filled 2026-09-30: the repository is public at https://github.com/beautifulrem/zeceipt since 2026-09-29 (WBS 4.1.1.1).
Refreshed 2026-09-30 (PM round 2, N02): the testnet receipts (PROOF §6), the `zdp:1:` check (§7) and the live page are in; "What does not exist yet" now names mainnet, not the testnet run. If a mainnet receipt exists by the day it is posted (RSK-3, cut-off 10-02), change that line first. Target post date 10-01, the day of the Zcash Foundation's architecture workshop (`11_plan.md` §8).
Suggested category: Applications, or Ecosystem Tooling if the forum has it. Suggested title below.
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
-->

# Shielded payment receipts: looking for one pilot

If your team pays contributors in shielded ZEC, you can already keep amounts and recipients private. What is still hard is showing a single payment to someone who needs to see it (the contributor, an auditor, a grant committee) without opening the whole wallet.

**Zeceipt** is a receipt for one shielded output. It carries that output's key (the OCK derived from the sender's outgoing viewing key). With it, anyone can decrypt exactly that output from the chain and read its recipient, amount and memo. Nothing else is disclosed: no other output, no other transaction, and no balance.

## What a receipt proves, and what it does not

**It proves** that the named transaction contains an output paying this value to this recipient with this memo, and that whoever made the receipt knew that output's key. Deriving the key takes the sender's outgoing viewing key, but anyone holding an earlier receipt for that output knows it too; a signature says which key made the receipt, not who the sender is.

**It does not prove**:
- who is showing it: a receipt is a bearer document. For an interactive check, ask for a signed receipt bound to your challenge (a challenge counts only on a signed receipt).
- that the output is still unspent, or that whoever shows it can spend it (a receipt carries no spending ability);
- anything about the transaction's other outputs, or about balances;
- which organisation holds the signing key, unless the key id names a domain and that domain lists the key when you check it (then it vouches for the key now, not for when the receipt was made);
- spend authority (full ZIP 311 is a roadmap item).

**What it costs** (the spec's §9): a receipt reveals that output's address, so receipts to the same address are linkable; pay each contributor at a fresh address from their wallet (the console warns before paying an address an earlier receipt disclosed). And disclosure is permanent: a receipt cannot be revoked.

Both follow the spec's own wording ([`spec/receipt-v0.md`](https://github.com/beautifulrem/zeceipt/blob/master/spec/receipt-v0.md) §4 and §9).

## What works today

- **Receipt core and CLI** (Rust, `librustzcash` crates): Ironwood outputs of v6 transactions, issued and verified end to end on a regtest chain and on a synthetic transaction built from a real mainnet v6 template (it is on no chain); real mainnet v6 transactions are parsed and fetched over gRPC. Orchard and Sapling output recovery is implemented and tested against the official Orchard vectors and Sapling round trips; the Orchard pool is sealed, so Orchard receipts are historical. `zeceipt issue` recovers each output the viewing key opens and writes a signed receipt; `zeceipt verify` fails closed at a named step (txid, signature, challenge, output, recovery). `zeceipt pack` and `verify-pack` bundle a period's receipts with a verified total, labelled a lower bound.
- **Receipts on Zcash testnet:** three payments (0.01, 0.02 and 0.03 TAZ, mined at heights 4,420,000 to 4,420,005), each with a signed receipt that verifies against a public node, offline from the raw transaction, and on the live receipt page: [open one in your browser](https://beautifulremi.dpdns.org/zeceipt/r#eyJ2ZXJzaW9uIjoiemVjZWlwdC12MCIsIm5ldHdvcmsiOiJ0ZXN0IiwicG9vbCI6Imlyb253b29kIiwidHhpZCI6ImZjZmRlNjI1Njg1YjQzZDdhYjE3Njk3MDhmNWE2NmQ3YThmZTg4YWJiZmM2ZTE0OTk4NGYzYzBhZGE2ODdmMGIiLCJvdXRwdXRfaW5kZXgiOjIsIm9jayI6IlJQdWhlNjBCcm5IUnJSVFFlNGZkR2E1bzF6N0dhQzQ1ajA2RGVTdWhQM0EiLCJsYWJlbCI6IklOVi1ULTAwMSIsImlzc3Vlcl9rZXlfaWQiOiJ0ZXN0bmV0LTIwMjYtMDkiLCJpc3N1ZXJfcHVia2V5IjoiY2QzNGY1NTM1YzEzOTg1ODA0MjlmODJiNGQyMzQ0ZTU1MzEzMjE0OGM4ZTY3Mzc2YjU2Nzg5MDFmODRhM2Y2ZSIsInNpZ25hdHVyZSI6IjFiNmQ2Nzc0YzdkNDkwYjQ2NjZhNWI0NWQ1NmM1MTM3NGVkMmRhYzUzZWI2NGE4YWI0M2QzOTc4MTA5Mjk5ZDk0ZDBkMmE2YmNhMjA1ZjU2MTQwMzBlNjI2Y2U2ZTMzYTlhMmE5YzRkNTI5OGQ5MmIwNTgxOGE2ODA0YjJlNzAwIiwiemlwMzExX3Byb2ZpbGUiOiJvdXRwdXRzLW9ubHkifQ) (the page asks a public testnet node for the transaction when you click Fetch). Their pack totals 0.06 TAZ, and a tampered copy is refused.
- **Recipients can prove a payment too.** The same verifier checks zcash-delivery-proof's `zdp:1:` proofs, which a recipient makes with an incoming viewing key. That project's own mainnet test vector verifies live, in the CLI and on the receipt page; it is their payment, not ours.
- **Consensus-valid proof on a private regtest chain:**
  - a real wallet (zcash-devtool) builds an Ironwood transaction, Zebra mines it and Zaino indexes it;
  - receipts are issued from the sender's UFVK and verified over gRPC and offline;
  - a three-recipient batch paid through Zkool yields exactly one receipt per payment output, with change excluded.
- **An issuer binding** (spec §7). Give your signing key an id that names your domain, such as `2026-09@pay.example.org`, and serve the small file `zeceipt well-known` prints at `https://<your domain>/.well-known/zeceipt.json`, over HTTPS, without redirects and with `Access-Control-Allow-Origin: *`. `zeceipt verify --check-issuer` and the receipt page's "Check with <domain>" then show whether your domain lists the key. The check never changes whether a receipt is valid, and it runs only when asked, because it tells your domain that someone is checking.
- **A receipt page that sends the receipt nowhere.** The link carries the receipt in the URL fragment, which browsers never send to a server. The page verifies in the browser (WASM), and a Chrome test checks that no request, header or storage entry holds the receipt. To check the chain, it asks a node for the transaction only when you click, and a public node then sees which txid you asked for; a raw-transaction file avoids even that.
- **A payout console** (Next.js, self-hosted, loopback only):
  - payables in USD, converted at a locked ZEC/USD rate;
  - a batch paid in one transaction, and paid again only when an uncertain attempt is known not to have been mined (the remaining edge cases are in the risk register, RSK-21);
  - an approval bound by HMAC to the exact lines, rate and paying account;
  - a rate check before paying;
  - receipts issued automatically after N confirmations;
  - an append-only history of each batch, recipient and payable;
  - no double payment after a database restore once the earlier payment is mined: before paying, it checks the wallet's mined history and adopts a payment already made. A payment still unmined at restore time is not seen.

  It drives Zkool: the seed stays in the wallet, and the console holds a viewing key and a Zkool token for its own account only. It refuses to pay through a Zkool that answers requests without a token. Shown on regtest end to end: batches made on the form, and batches made from USD payables at Kraken's live rate with receipts issued automatically.

Evidence for each item: [`docs/PROOF.md`](https://github.com/beautifulrem/zeceipt/blob/master/docs/PROOF.md) §1, §2, §2b–§2e, §5, §5b–§5g, §6 (testnet) and §7 (delivery proofs).

## What does not exist yet

- **Receipts on mainnet:** three signed receipts verify on testnet today (above; `docs/PROOF.md` §6); a pilot's batch would be the first zeceipt receipts on mainnet. This is why I'm asking for a pilot.
- **Two approvers:** the console has one approver and no sign-in yet.
- **Accounting exports:** the console exports a batch in OpenZcash's own CSV format, plus a receipt link per row; QuickBooks and Xero are not built for this hackathon. If you maintain a ledger, would that format be useful to you?

## The pilot I'm looking for

One team that pays 3–10 contributors in shielded ZEC and wants each of them, or an auditor, to be able to check their payment:

1. You pay one real batch. Either use the console against your Zkool, or keep your own wallet and use the CLI with your viewing key.
2. Each recipient gets a receipt link and can verify it in the browser, with nothing installed.
3. You tell me what was missing.

Timing: a batch paid by 9 October can be named in our hackathon submission, with your consent; later is just as welcome.

Your keys stay yours: the console never holds a spending key, and the CLI needs a viewing key plus a receipt-signing key it generates (`zeceipt keygen`), never a spending key. Expect about an hour of your time. ZecHub's bounty payouts, a ZCG grantee team, or a payroll team (hello, Konclave users) would be ideal.

## Questions for everyone

- Who needs to see a single payment in your workflow: the recipient, an auditor, a grant committee, or the public?
- Is a per-output receipt enough, or do you use the per-period pack, and what should it add?
- Would you rather verify in the browser, with the CLI, or both?

## Neighbours

Konclave pays shielded payroll with FROST approvals. Laminar (the RFC and grant thread on this forum) proposes a local-first treasury console whose receipt bundles prove the integrity of payment intent. Zeceipt is complementary to both: it proves what a shielded output actually paid, per output, against the chain.

Code and docs: https://github.com/beautifulrem/zeceipt (start with the [README](https://github.com/beautifulrem/zeceipt/blob/master/README.md)). Built for Colosseum's Crypto World's Fair, Zcash track.
