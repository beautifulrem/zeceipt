<!--
DRAFT, not posted (WBS 5.1.1.5; slice WU2b). Recording and posting are the user's: a one-minute video, due 2026-10-05; fallback:
by 10-07, or skipped (the updates are "not mandatory", strongly recommended; `11_plan.md` §8). Post it where update 1 went.
Official brief: "a concise, one-minute video highlighting progress and notable challenges from the previous week" (colosseum.com/hackathon).
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing. Written on 09-28: before
recording, apply "Rows that depend on the week" below, and re-read "Do not say".
Footage, each row naming its take: `5-export.webm` and `6-pack.webm` from `../raw/demo/20260926182327/` (regtest, slice V2c2);
`10-nu7-refusal.webm` from `../raw/demo/20260928091704/` (no chain: the committed batch transaction and a copy with NU7's branch
id; `apps/console/test/shots/nu7-refusal.ts`, slice WU2a). Cue times are video times, checked on frames.
-->

# Weekly update 2 (week of 28 September to 4 October): script and shot list

128 spoken words in 60 seconds (1.3 to 2.3 words a second per row; the last two rows leave room for the lines that depend on the week). The voice-over is spoken over the footage. Title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:05 | Title card: "Zeceipt — update 2 (28 Sep–4 Oct)" and the line "A receipt for one shielded Zcash payment" | "Zeceipt, update two: a receipt for one shielded Zcash payment." |
| 0:05–0:21 | Take 20260926182327. `5-export.webm` at 1.5 s, held to 0:10; at 4.5 s, the downloaded file as a table, held to 0:15. Then `6-pack.webm` at 1.0 s: `verify-pack`, five receipts valid, held to 0:21 | "Not shown last time: a paid batch downloads in the format OpenZcash's export uses, with a receipt link on every row. And an auditor checks a pack of receipts instead of asking for your viewing key." |
| 0:21–0:44 | `10-nu7-refusal.webm` (take 20260928091704): 0.1–4.1 s (its first frame is white), the batch transaction as it is (v6, six outputs), held to 0:26; from 4.1 s, the same bytes with NU7's branch id, refused by name, held to 0:44. The on-screen comment says the second file is a stand-in | "This week's challenge: the draft spec for Zcash's next upgrade, NU7, gives it a new consensus branch. Our verifier would have called such a transaction malformed. Now it names the upgrade, and says this version can't read it yet. With the upstream fix, not yet released, the same test transaction issues and verifies." |
| 0:44–0:53 | Title card: "Receipt pages: a fallback testnet endpoint" (see "Rows that depend on the week") | "The receipt page gained a fallback testnet endpoint, and says the node and any service behind it see the lookup." |
| 0:53–1:00 | Title card: "Next: …" (see below) | "Next: receipts on a public chain, and the videos." |

## Rows that depend on the week

Say these only if they are true when recording. Each replaces the 0:44 row, keeping the total at about 60 seconds.

- **The public-chain run has happened** (PROOF §6): use its footage, `zeceipt verify` on a public-chain receipt and the transaction in an explorer. Say "on testnet" or "on mainnet", as PROOF §6 records it: "Receipts now run on [testnet]: this one verifies against a public node." The last card then reads "Next: the videos, and one pilot", and so does its line.
- **A pilot paid a real batch** (4.2.1.1): one sentence naming the payer only if they agreed to be named, otherwise "one team".
- **The repository is public** (4.1.1.1): add "The code is open source" to the last line.
- **Neither happened:** keep the rows above as written. They are true today.

## Do not say

- **"NU7 transaction"** without saying it is a stand-in. No NU7 transaction exists yet: the second file is the batch's own bytes with the header's branch id changed, and it is not consensus-valid, because its signatures commit to the old branch. The on-screen comment says so, and "test transaction" in the voice-over covers it.
- **"Ready for NU7" or "supports NU7":** the released build refuses NU7's branch. Support waits for Zcash's crates to release it (U1c, RSK-14).
- **"on mainnet" or "on testnet"** over the export and pack footage: both are regtest.
- **"NU7 has been released" or "NU7 is live":** ZIP 259 is a draft; activation is announced for 2026-10-06 on testnet and 2026-11-05 on mainnet (R121, R128). Recorded on 10-05, neither is live.
- **"Independent nodes"** or **"a second node":** both testnet endpoints reach one operator, zec.rocks, because ChainSafe's is a proxy to it (R125).
- **"audited":** the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- **Solana, or exports for accounting software** (not the OpenZcash CSV, which is built): dropped, or planned and not built.
