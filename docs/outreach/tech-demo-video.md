<!--
DRAFT (WBS 5.1.1.2; slice V2d). Recording, narration and upload are the user's, in 2026-10-04 → 10-07 (`11_plan.md` §8).
Official brief: a product demo of at most 3 minutes, in English (KB `04_submission.md`); the KB's advice: real product use with
narration (KB `11_strategy.md` §六). Steps follow `11_plan.md` §5's technical demo. Every sentence is backed by the evidence in
`.trellis/tasks/09-27-tech-demo-script/implement.md`.
Footage: `3-receipt-page.webm` from take `../raw/demo/20260925230743/` (slice L2). The shots marked V2e (terminal and console) are
not recorded yet: they will be real commands, run as shown, with every OCK filtered out of what is on screen.
-->

# Technical demo (≤ 3:00): script and shot list

The voice-over is spoken over the picture, at about 2 words a second: 297 words, about 2:32 in all (1.92 to 2.0 words a second per row), under the 3:00 limit. Title cards are plain text on a dark background. Every shot is on a local Zcash test chain (regtest): say so once at the start.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:13 | Title card: "Zeceipt: how one shielded payment becomes a receipt" | "This is how Zeceipt turns one shielded Zcash payment into a receipt that anyone can check, and what that receipt does and does not prove." |
| 0:13–0:29 | V2e, terminal: `zeceipt inspect --regtest --endpoint … --txid <the batch's txid>` and its output | "Everything here runs on a local Zcash test chain. Start from the console's batch payment: a version 6 transaction, and the six Ironwood outputs it lists, five payments and the change." |
| 0:29–0:58 | V2e, terminal: `zeceipt issue --regtest … --ufvk-file … --key-file …` piped to `jq`, showing each receipt's recovered recipient, amount, memo and output index, never its key | "The issuer holds the sender's full viewing key, which gives its outgoing viewing key. For each output, the protocol derives an Outgoing Cipher Key from that key and the output's own data. That one key opens that one output, and nothing else. Issuing skips the change, because it pays the sender's own address, and signs five receipts." |
| 0:58–1:16 | `3-receipt-page.webm` (take 20260925230743): VALID from raw 0.3 s, held; INVALID from raw 3.66 s | "In the browser, the same Rust code, compiled to WebAssembly, recovers the recipient, the amount and the memo from the transaction with that key. Change one character of the receipt, and the signature check fails." |
| 1:16–1:30 | Title card: "A viewing key shows everything. A receipt shows one output." | "Why not just share a viewing key? It is all or nothing: every payment, and every future one. A receipt discloses one output, permanently, and nothing more." |
| 1:30–1:52 | V2e, console: the batch page's "Payment mode" panel in hot custody, then a console started in external custody | "The console has two custody modes. In hot custody it pays through the Zkool wallet, with a token scoped to its own account, and the seed stays in the wallet. In external custody it holds the viewing key only, and refuses to pay." |
| 1:52–2:14 | Title card: "ZIP 311: the outputs half, without spend authority" | "The trade-off: this is the outputs half of ZIP 311. The spend-authority half needs the spending key. So anyone with the viewing key, or an earlier receipt, can make one, and a signature ties a receipt to a key, not to the sender." |
| 2:14–2:32 | V2e: `docs/PROOF.md` scrolled through its section headings (§5–§5g) | "Every step shown ran on a consensus-valid chain with Zebra, Zaino and the Zkool wallet. The proof document keeps each transcript, and every test can be re-run from the repository with the commands in its README." |

## If the public-chain run has happened

Add one row after 0:58: `zeceipt verify` on a public-chain receipt, and the transaction in a block explorer (PROOF §6). Say "on mainnet" or "on testnet" only over that row.

## Do not say

The pitch's list applies (`docs/outreach/pitch-video.md`, "Do not say"). The rules most relevant here:
- **"from the chain"** over the receipt page: it loads the transaction from a file.
- **"on mainnet" or "on testnet"** over regtest shots.
- **"proves the sender"** or **"proves who paid"**: a signature attributes a receipt to a key.
- **"the tests run in CI"**, until the repository is pushed and CI has run.
