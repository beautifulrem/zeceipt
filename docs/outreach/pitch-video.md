<!--
DRAFT (WBS 5.1.1.1; slice V2b). Recording, editing and uploading are the user's, in 2026-10-04 → 10-07 (`11_plan.md` §8).
Official brief: a presentation (pitch) video of 2 to 3 minutes, in English, uploaded to a platform such as YouTube (KB `04_submission.md`);
the product demo is a separate video of at most 3 minutes (WBS 5.1.1.2).
Beats follow `11_plan.md` §5 in order (its times are approximate; this script's are the recording's). Every sentence is backed by
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
Footage: take `20260930083345`, all nine segments recorded on the live regtest chain by `apps/console/test/shots/demo-video.ts`
on 2026-09-30, after the UI changes of 09-29 and 09-30, in `../raw/demo/20260930083345/` (cue sheet: `docs/outreach/footage-20260930.md`).
The UI freeze from 10-01 keeps it valid. Cue times are video times, checked on that take's frames on 2026-09-30
(`ffmpeg -ss <t> -i X.webm -frames:v 1 f.png`); they agree with the take's shots.json to within about 0.3 s.
-->

# Pitch video (≤ 3:00): script and shot list

275 scripted words in 2:08 (2.0 to 2.3 words a second per row), then the user's team lines, about 80 words in 36 seconds. That makes about 2:44, with 16 seconds of slack under the 3:00 limit. The voice-over is spoken over the picture. Title cards are plain text on a dark background. The team lines are the user's own words.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:18 | The speaker on camera (or a title card: "Zeceipt — a receipt for one shielded Zcash payment") | "If your organisation pays people in shielded Zcash, proving one payment today usually means handing over your viewing key, and that shows every payment you have ever made. Zeceipt gives you a receipt for exactly one payment instead." |
| 0:18–0:46 | `1-console.webm` (take 20260930083345), held where the words are: raw 0–7.3 s (recipients from 0.6 s, payables from 2.8 s, the chooser from 4.3 s; the batch fades in at 7.0–7.3 s, 0:25.3); hold the "Approve paying 0.92000772 ZEC at 1 ZEC = $1,394.01" frame (raw 7.4 s) to 0:33, while "become one batch at Kraken's rate" is spoken; raw 7.4–8.8 s, then hold the "Approved" frame (raw 8.8 s) to 0:40.5, under the approval sentence; raw 11.8–12.8 s (Pay pressed: "Paying…" from raw 11.84 s, at 0:40.5); cut to raw 25.4 s ("Broadcast" at 0:41.5) and play to raw 29.9 s (0:46) | "This is the console, on a local Zcash test chain. Five bounties in US dollars, typed in here or imported from a zecpay CSV, become one batch at Kraken's rate, fixed for the batch. I approve it, and the approval is bound to these lines, this rate and the paying account. Then the Zkool wallet pays all five in one shielded transaction." |
| 0:46–1:07 | `2-receipts.webm` (take 20260930083345; 5.7 s: confirmed at 0.3 s, the five receipts at 2.2 s), then the live page on a public chain: `../raw/demo/public-20260930/1-testnet-receipt.webm` from 3.4 s (the link's claims), VALID at 7.0 s, the three parts at 10.2 s, held to 1:07 (on screen: "testnet"; judge round 3, N3-7) | "When it confirms, I issue a receipt for each payment. Each receipt discloses the key to one output, and nothing else. The recipient opens their link, and their browser recovers their address, amount and memo from the transaction, in milliseconds. The receipt itself never leaves their browser." |
| 1:07–1:14 | `3-receipt-page.webm` (take 20260930083345) from raw 3.7 s (the changed link loads; INVALID, the stage named, from 4.2 s), held to 1:14 | "Change one character, and it fails, and the page says where: here, the signature." |
| 1:14–1:37 | Take 20260930083345. `5-export.webm` at 1.0 s: the batch page's receipts, what the file holds, its permanent disclosure and "Download for OpenZcash (CSV)", held to 1:19; at 4.1 s: the downloaded file as a table (links and txids abridged on screen), held to 1:26.5. Then `6-pack.webm` at 0.5 s (the whole output is on screen from its first frame): `zeceipt pack` and `verify-pack`, five receipts valid, and the totals with the lower-bound note, held to 1:37 (zoom on the note from 1:31 if the editor can) | "For the public, the batch downloads in the format OpenZcash's own export uses, with a receipt link on every row, so anyone can check a row. For an auditor, a pack of receipts replaces the viewing key. Its total is a lower bound, and it says so." |
| 1:37–1:51 | `4-import.webm` (take 20260930083345): raw 2.0 s, the preview (two new recipients, Ana matched by Orchard receiver under the file's other name, each row's address, the ZEC row refused by its CSV line), held to 1:43; raw 5.1 s, "Imported 3 payables and 2 new recipients", to 1:46; then raw 8.3 s, the three new payables in the list with their references, to 1:51 | "It fits the tools teams already use. It reads Konclave's payroll file and zecpay's, and any payout tool can issue receipts by calling our library after it pays." |
| 1:51–2:08 | Title card: "Free issuer tier · team plans · verification API (planned)" and, below, "Receipts live on Zcash testnet · Next: a pilot with a real payer" | "We plan a free tier for issuers, paid team plans, and a verification API. Our receipts are live on testnet. Next: a pilot with a real payer, and mainnet. Later, proof that the sender signed, which needs the wallet." |
| 2:08–2:44 | The speaker on camera | The user's own two to four sentences: who you are, and why you are the ones to build this (`11_plan.md` §5, the 2:50 beat). |

## Choices that depend on the user's own steps

Say these only when they are true at the time of recording:
- **"The code is open source"**, after the repository is public (WBS 4.1.1.1; true since 2026-09-29). It could go at the end of the 1:51 line.
- **"Our receipts are live on testnet"**: applied 2026-09-30, since the testnet run happened (PROOF §6: three signed receipts, verified online, offline and on the live page); "local Zcash test chain" stays for the regtest footage. Say "mainnet" about zeceipt's own receipts only if a mainnet receipt is issued before the recording (RSK-3, cut-off 10-02); the 1:51 line then names mainnet instead of testnet, and drops "and mainnet" from its next sentence.
- **"We've opened a pilot call on the Zcash forum"**, after the forum post.

## Do not say

- **"the money is still there"** or **"the recipient can spend it"**: a receipt shows a payment was made, not that the output is unspent (Monero's payment proofs carry the same warning, `docs/product/12_next_steps.md`).
- **"on mainnet" or "on testnet"** over this footage: every shot is regtest (the 1:51 title card is the one place that names testnet). And never "on mainnet" about zeceipt's receipts while they are testnet only: the mainnet payment the live page can show is zcash-delivery-proof's test vector (PROOF §7).
- **"automatically"** about these receipts: the footage shows the Issue receipts button.
- **"from the chain"** over the receipt page: it shows "Chain inclusion: Unknown", because the transaction was loaded from a file.
- **"never pays twice"**: after an uncertain outcome the console pays again only when nothing is mined past the attempt's expiry bound, and RSK-21 lists the cases that remain.
- **"audited"**: the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- **Solana, accounting exports, or a Konclave adapter**: dropped, or planned and not built.
- **"the only"**, **"nobody else"**, or that a viewing key is the only way today: Glasspane made per-payment receipts on Zcash's Orchard pool (dormant since 2026-07-13, `03_market_competition.md`), and only Solana's auditor keys and Monero's proofs were checked elsewhere (`11_plan.md` §6).
- **"without contacting us"**: the receipt page is served by the link's host, and on a public chain it asks a node when the recipient clicks. What is true: the receipt stays in the link's fragment, which the browser never sends (spec §2.1).
- **"users" or "customers"**: there are none yet.
- **The receipt links' host** (`http://127.0.0.1:…/r#…` in the CSV shot): it is the local test page. If it comes up, say so: a real deployment serves the page from a host it controls, over HTTPS (README, "Receipt links"; THREAT_MODEL calls a loopback host an operator error).
