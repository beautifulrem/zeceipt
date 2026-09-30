<!--
DRAFT (WBS 5.1.1.2; slice V2d). Recording, narration and upload are the user's, in 2026-10-04 → 10-07 (`11_plan.md` §8).
Official brief: a product demo of at most 3 minutes, in English (KB `04_submission.md`); the KB's advice: real product use with
narration (KB `11_strategy.md` §六). Steps follow `11_plan.md` §5's technical demo. Every sentence is backed by the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
Footage: every regtest shot is from take `20260930083345` (`../raw/demo/20260930083345/`), recorded on the live regtest chain by
`apps/console/test/shots/demo-video.ts` on 2026-09-30, after the UI changes of 09-29 and 09-30 (cue sheet: `docs/outreach/footage-20260930.md`);
its terminal runs real commands as shown, with every OCK filtered out of what is on screen. The UI freeze from 10-01 keeps it valid.
Cue times are video times, checked on that take's frames on 2026-09-30. The 1:30 testnet row (added 2026-09-30, PM round 2, N03) is the
separate public-chain recording `../raw/demo/public-20260930/`: the live receipt page on testnet INV-T-001, the recipient's zdp link and
the zdp mainnet vector (PM round 3, P07); cue it from that recording's frames.
-->

# Technical demo (≤ 3:00): script and shot list

The voice-over is spoken over the picture, at about 2 words a second: 343 words, about 2:57 in all (1.86 to 1.97 words a second per row), 3 seconds under the 3:00 limit. Title cards are plain text on a dark background. Every shot except the 1:30 row is on a local Zcash test chain (regtest): say so once at the start. The 1:30 row is Zcash testnet, zeceipt's own receipts (PROOF §6), and is the only place to say "testnet".

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:13 | Title card: "Zeceipt: how one shielded payment becomes a receipt" | "This is how Zeceipt turns one shielded Zcash payment into a receipt that anyone can check, and what that receipt does and does not prove." |
| 0:13–0:29 | `7-tech-terminal.webm` (take 20260930083345) from 0.1 s: `zeceipt inspect --regtest …` piped to `jq`, printing V6 and six Ironwood outputs, held. Narrate the count `inspect` prints (a bundle is padded, so a wallet spending more notes can show dummy outputs); the take asserts six | "This part runs on a local Zcash test chain. Start from the console's batch payment: a version 6 transaction, and the six Ironwood outputs it lists, five payments and the change." |
| 0:29–0:58 | `7-tech-terminal.webm` from 3.1 s (the output appears at 3.0 s): `zeceipt keygen` (a demo key, its public key only), then `zeceipt issue --regtest … --ufvk-file … --key-file demo.key` piped to `jq`: five receipts, each with its output index, amount, memo and `is_change: false`, never a key; held | "The issuer holds the sender's full viewing key, which gives its outgoing viewing key. For each output, the protocol derives an Outgoing Cipher Key from that key and the output's own data. That one key opens that one output, and nothing else. Issuing skips the change, because it pays the sender's own address, and signs five receipts." |
| 0:58–1:16 | `3-receipt-page.webm` (take 20260930083345): VALID from raw 0.5 s, held; cut at raw 3.6 s to raw 4.2 s, INVALID with the stage named, held | "In the browser, the same Rust code, compiled to WebAssembly, recovers the recipient, the amount and the memo from the transaction with that key. Change one character of the receipt, and the signature check fails." |
| 1:16–1:30 | `7-tech-terminal.webm` from 6.1 s (the output appears at 6.0 s): `zeceipt verify --regtest --endpoint … --require-signature <one receipt>` piped to `jq`: `valid: true`, the block height, the value and the memo, never the key; held | "The command line checks the same receipt against the chain itself: it fetches the transaction from the node and reports the block it was mined in." |
| 1:30–1:45 | `../raw/demo/public-20260930/` (the public-chain recording, not regtest): the live receipt page opening the README's testnet link (INV-T-001), Fetch pressed: VALID, 0.01 TAZ, memo INV-T-001, "Mined at height 4420000, N confirmations", "Signed by key cd34f553…3f6e (key id testnet-2026-09)", held (the recording's zdp shots are not for this row: the voice-over speaks of a signed receipt, and a delivery proof is unsigned). Its OCK is already public (`fixtures/testnet/`, the README). The terminal `zeceipt verify --testnet --require-signature fixtures/testnet/fcfde625685b43d7-ironwood-2.json` is not in that recording, and the voice-over does not need it | "The same receipts work on a public chain. On Zcash testnet, this signed receipt verifies against a public node, and the live page shows it valid, with its block." |
| 1:45–1:59 | Title card: "A viewing key shows everything. A receipt shows one output." | "Why not just share a viewing key? It is all or nothing: every payment, and every future one. A receipt discloses one output, permanently, and nothing more." |
| 1:59–2:21 | `8-custody.webm` (take 20260930083345): at 0.8 s the hot console's "Payment mode" ("Hot wallet: the seed lives only in Zkool; this console holds a viewing key"), held to 2:10; at 3.7 s a second console in external custody (on screen from 3.6 s; the take's shots.json says 4.2 s, wall-clock) ("External signer: this console never pays or tracks payments"), to 2:21 | "The console has two custody modes. In hot custody it pays through the Zkool wallet, with a token scoped to its own account, and the seed stays in the wallet. In external custody it holds the viewing key only, and refuses to pay." |
| 2:21–2:43 | Title card: "ZIP 311: the outputs half, without spend authority" | "The trade-off: this is the outputs half of ZIP 311. The spend-authority half needs the spending key. So anyone with the viewing key, or an earlier receipt, can make one, and a signature ties a receipt to a key, not to the sender." |
| 2:43–2:57 | `9-proof.webm` (take 20260930083345) at 0.5 s: `docs/PROOF.md`'s regtest section headings, §5 to §5g, held | "Every other step ran on a consensus-valid chain with Zebra, Zaino and the Zkool wallet. The proof document keeps each transcript; every test re-runs from the repository." |

## The public-chain run (applied 2026-09-30)

It happened on testnet on 2026-09-30 (PROOF §6), so the 1:30 row above is in the script, and the proof row was shortened to keep the total under 3:00. Zeceipt has no receipt on mainnet: the mainnet payment the receipt page can show is zcash-delivery-proof's own test vector (PROOF §7), not zeceipt's. If a mainnet receipt is issued before the recording (RSK-3, cut-off 10-02), the 1:30 row may show it instead, and say "mainnet" only over it.

## Do not say

The pitch's list applies (`docs/outreach/pitch-video.md`, "Do not say"). The rules most relevant here:
- **"from the chain"** over the receipt page: it loads the transaction from a file. Over the `zeceipt verify --regtest` shot it is true: the CLI fetches the transaction from the node.
- **"on mainnet" or "on testnet"** over regtest shots; **"on mainnet"** about zeceipt's own receipts, which are on testnet (PROOF §6).
- **"proves the sender"** or **"proves who paid"**: a signature attributes a receipt to a key.
- (Lifted 2026-09-30: "the tests run in CI" is true since the repository went public on 2026-09-29, and CI is green on master. Say it with a count only if it is the checked one: as `scripts/check_test_counts.py` prints it on the day (540 run by default on 2026-09-30: 75 Rust and 465 console).)
