<!--
DRAFT, not posted (WBS 4.1.2.2; slice L1). Posting is the user's decision: a public action on forum.zcashcommunity.com.
Prerequisite: push the repository (WBS 4.1.1.1), then replace every `[after the push]` with the public link.
Suggested category: Applications, or Ecosystem Tooling if the forum has it. Suggested title below.
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
-->

# Shielded payment receipts: looking for one pilot

If your team pays contributors in shielded ZEC, you can already keep amounts and recipients private. What is still hard is showing a single payment to someone who needs to see it (the contributor, an auditor, a grant committee) without opening the whole wallet.

**Zeceipt** is a receipt for one shielded output. It carries that output's key (the OCK derived from the sender's outgoing viewing key). With it, anyone can decrypt exactly that output from the chain and read its recipient, amount and memo. Nothing else is disclosed: no other output, no other transaction, and no balance.

## What a receipt proves, and what it does not

**It proves** that the named transaction contains an output paying this value to this recipient with this memo, and that whoever made the receipt knew that output's key. Deriving the key takes the sender's outgoing viewing key, but anyone holding an earlier receipt for that output knows it too; a signature says which key made the receipt, not who the sender is.

**It does not prove**:
- who is showing it: a receipt is a bearer document. For an interactive check, bind a challenge.
- that the output is still unspent, or that whoever shows it can spend it (a receipt carries no spending ability);
- anything about the transaction's other outputs, or about balances;
- which organisation holds the signing key, unless the key id names a domain and that domain lists the key when you check it (then it vouches for the key now, not for when the receipt was made);
- spend authority (full ZIP 311 is a roadmap item).

**What it costs** (the spec's §9): a receipt reveals that output's address, so receipts to the same address are linkable; pay each contributor at a fresh address from their wallet (the console warns before paying an address an earlier receipt disclosed). And disclosure is permanent: a receipt cannot be revoked.

Both follow the spec's own wording (`spec/receipt-v0.md` §4 and §9 [after the push]).

## What works today

- **Receipt core and CLI** (Rust, `librustzcash` crates): Ironwood outputs of v6 transactions, issued and verified end to end on a regtest chain and on a synthetic transaction built from a real mainnet v6 template (it is on no chain); real mainnet v6 transactions are parsed and fetched over gRPC. Orchard and Sapling output recovery is implemented and tested against the official Orchard vectors and Sapling round trips; the Orchard pool is sealed, so Orchard receipts are historical. `zeceipt issue` recovers each output the viewing key opens and writes a signed receipt; `zeceipt verify` fails closed at a named step (txid, signature, challenge, output, recovery). `zeceipt pack` and `verify-pack` bundle a period's receipts with a verified total, labelled a lower bound.
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

Evidence for each item: `docs/PROOF.md` §1, §2, §2b–§2e, §5 and §5b–§5g [after the push].

## What does not exist yet

- **Receipts on a public chain:** the testnet run is prepared and waits on faucet funds, and mainnet comes after. This is why I'm asking for a pilot.
- **Two approvers:** the console has one approver and no sign-in yet.
- **Accounting exports:** the console exports a batch in OpenZcash's own CSV format, plus a receipt link per row; QuickBooks and Xero are not built for this hackathon. If you maintain a ledger, would that format be useful to you?

## The pilot I'm looking for

One team that pays 3–10 contributors in shielded ZEC and wants each of them, or an auditor, to be able to check their payment:

1. You pay one real batch. Either use the console against your Zkool, or keep your own wallet and use the CLI with your viewing key.
2. Each recipient gets a receipt link and can verify it in the browser, with nothing installed.
3. You tell me what was missing.

Timing: a batch paid between 1 and 3 October makes it into our hackathon submission; later is just as welcome.

Your keys stay yours: the console never holds a spending key, and the CLI needs a viewing key plus a receipt-signing key it generates (`zeceipt keygen`), never a spending key. Expect about an hour of your time. ZecHub's bounty payouts, a ZCG grantee team, or a payroll team (hello, Konclave users) would be ideal.

## Questions for everyone

- Who needs to see a single payment in your workflow: the recipient, an auditor, a grant committee, or the public?
- Is a per-output receipt enough, or do you use the per-period pack, and what should it add?
- Would you rather verify in the browser, with the CLI, or both?

## Neighbours

Konclave pays shielded payroll with FROST approvals. Laminar (the RFC and grant thread on this forum) proposes a local-first treasury console whose receipt bundles prove the integrity of payment intent. Zeceipt is complementary to both: it proves what a shielded output actually paid, per output, against the chain.

Code and docs: [after the push]. Built for Colosseum's Crypto World's Fair, Zcash track.
