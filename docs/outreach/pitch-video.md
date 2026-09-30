<!--
DRAFT (WBS 5.1.1.1; slice V2b). Recording, editing and uploading are the user's, in 2026-10-04 → 10-07 (`11_plan.md` §8).
Official brief: a presentation (pitch) video of 2 to 3 minutes, in English, uploaded to a platform such as YouTube (KB `04_submission.md`);
the product demo is a separate video of at most 3 minutes (WBS 5.1.1.2).
Beats follow `11_plan.md` §5 in order (its times are approximate; this script's are the recording's). Every sentence is backed by
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
Footage (regtest only; recorded by `apps/console/test/shots/demo-video.ts`), from three takes, each named in its row: segments 1–3
from `../raw/demo/20260925230743/` (slice L2), segment 4 (the import) from `../raw/demo/20260926144231/` (slice V2c1), segments 5
and 6 (the OpenZcash download, the audit pack) from `../raw/demo/20260926182327/` (slice V2c2). Each take has all its segments,
with other timings: use each row's take. Cue times are video times, checked on frames: a take's shots.json gives wall-clock
offsets, and the recorder can shorten a clip where the page does not change.
-->

# Pitch video (≤ 3:00): script and shot list

273 scripted words in 2:08 (2.0 to 2.3 words a second per row), then the user's team lines, about 80 words in 36 seconds. That makes about 2:44, with 16 seconds of slack under the 3:00 limit. The voice-over is spoken over the picture. Title cards are plain text on a dark background. The team lines are the user's own words.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:18 | The speaker on camera (or a title card: "Zeceipt — a receipt for one shielded Zcash payment") | "If your organisation pays people in shielded Zcash, proving one payment today usually means handing over your viewing key, and that shows every payment you have ever made. Zeceipt gives you a receipt for exactly one payment instead." |
| 0:18–0:46 | `1-console.webm` (take 20260925230743), held where the words are: raw 0–6.0 s (recipients, payables; the batch appears at 0:24); hold the "Approve paying … at 1 ZEC = $1,553.29" frame (raw 6.0 s) to 0:33, while "become one batch at Kraken's rate" is spoken; raw 6.0–7.5 s, then hold the "Approved" frame (raw 7.5 s) to 0:40.5, under the approval sentence; raw 10.6–11.6 s (Pay pressed at 0:40.5); cut to raw 18.9 s ("Broadcast" at 0:41.5) and play to raw 23.4 s (0:46) | "This is the console, on a local Zcash test chain. Five bounties in US dollars, typed in here or imported from a zecpay CSV, become one batch at Kraken's rate, fixed for the batch. I approve it, and the approval is bound to these lines, this rate and the paying account. Then the Zkool wallet pays all five in one shielded transaction." |
| 0:46–1:07 | `2-receipts.webm` (take 20260925230743; 5.6 s), then `3-receipt-page.webm` (same take) raw 0–3.6 s (VALID), holding on VALID | "When it confirms, I issue a receipt for each payment. Each receipt discloses the key to one output, and nothing else. The recipient opens their link, and their browser recovers their address, amount and memo from the transaction, in milliseconds. The receipt itself never leaves their browser." |
| 1:07–1:14 | `3-receipt-page.webm` (take 20260925230743) from raw 3.6 s (INVALID, the stage named) | "Change one character, and it fails, and the page says where: here, the signature." |
| 1:14–1:37 | Take 20260926182327. `5-export.webm` at 1.5 s: the batch page's receipts, what the file holds, its permanent disclosure and "Download for OpenZcash (CSV)", held to 1:19; at 4.5 s: the downloaded file as a table (links and txids abridged on screen), held to 1:26.5. Then `6-pack.webm` at 1.0 s: `zeceipt pack` and `verify-pack`, five receipts valid, and the totals with the lower-bound note, held to 1:37 (zoom on the note from 1:31 if the editor can) | "For the public, the batch downloads in the format OpenZcash's own export uses, with a receipt link on every row, so anyone can check a row. For an auditor, a pack of receipts replaces the viewing key. Its total is a lower bound, and it says so." |
| 1:37–1:51 | `4-import.webm` (take 20260926144231): raw 1.9 s, the preview (two new recipients, Ana matched by Orchard receiver under the file's other name, each row's address, the ZEC row refused by its CSV line), held to 1:43; raw 5.0 s, "Imported 3 payables and 2 new recipients", to 1:46; then raw 8.0 s, the three new payables in the list with their references, to 1:51 | "It fits the tools teams already use. It reads Konclave's payroll file and zecpay's, and any payout tool can issue receipts by calling our library after it pays." |
| 1:51–2:08 | Title card: "Free issuer tier · team plans · verification API (planned)" and, below, "Next: a pilot with a real payer" | "We plan a free tier for issuers, paid team plans, and a verification API. Next: a pilot with a real payer, and receipts on a public chain. Later, proof that the sender signed, which needs the wallet." |
| 2:08–2:44 | The speaker on camera | The user's own two to four sentences: who you are, and why you are the ones to build this (`11_plan.md` §5, the 2:50 beat). |

## Choices that depend on the user's own steps

Say these only when they are true at the time of recording:
- **"The code is open source"**, after the repository is public (WBS 4.1.1.1; true since 2026-09-29). It could go at the end of the 1:51 line.
- **"Receipts are live on a public chain"**, only after the public-chain run (PROOF §6). If it has happened, it replaces "and receipts on a public chain" in the 1:51 line, and "local Zcash test chain" stays for the regtest footage.
- **"We've opened a pilot call on the Zcash forum"**, after the forum post.

## Do not say

- **"the money is still there"** or **"the recipient can spend it"**: a receipt shows a payment was made, not that the output is unspent (Monero's payment proofs carry the same warning, `docs/product/12_next_steps.md`).
- **"on mainnet" or "on testnet"** over this footage: every shot is regtest.
- **"automatically"** about these receipts: the footage shows the Issue receipts button.
- **"from the chain"** over the receipt page: it shows "Chain inclusion: Unknown", because the transaction was loaded from a file.
- **"never pays twice"**: after an uncertain outcome the console pays again only when nothing is mined past the attempt's expiry bound, and RSK-21 lists the cases that remain.
- **"audited"**: the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- **Solana, accounting exports, or a Konclave adapter**: dropped, or planned and not built.
- **"the only"**, **"nobody else"**, or that a viewing key is the only way today: Glasspane made per-payment receipts on Zcash's Orchard pool (dormant since 2026-07-13, `03_market_competition.md`), and only Solana's auditor keys and Monero's proofs were checked elsewhere (`11_plan.md` §6).
- **"without contacting us"**: the receipt page is served by the link's host, and on a public chain it asks a node when the recipient clicks. What is true: the receipt stays in the link's fragment, which the browser never sends (spec §2.1).
- **"users" or "customers"**: there are none yet.
- **The receipt links' host** (`http://127.0.0.1:…/r#…` in the CSV shot): it is the local test page. If it comes up, say so: a real deployment serves the page from a host it controls, over HTTPS (README, "Receipt links"; THREAT_MODEL calls a loopback host an operator error).
