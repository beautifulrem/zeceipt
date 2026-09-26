<!--
DRAFT (WBS 5.1.1.1; slice V2b). Recording, editing and uploading are the user's, in 2026-10-04 → 10-07 (`11_plan.md` §8).
Official brief: a presentation (pitch) video of 2 to 3 minutes, in English, uploaded to a platform such as YouTube (KB `04_submission.md`);
the product demo is a separate video of at most 3 minutes (WBS 5.1.1.2).
Beats follow `11_plan.md` §5 in order (its times are approximate; this script's are the recording's). Every sentence is backed by
the evidence in `.trellis/tasks/09-26-pitch-script/implement.md`.
Footage: `../raw/demo/20260925230743/` (regtest only; recorded by `apps/console/test/shots/demo-video.ts`, slice L2); the shots
marked V2c are not recorded yet.
-->

# Pitch video (≤ 3:00): script and shot list

255 scripted words in 2:02 (2.0 to 2.3 words a second per row), then the user's team lines, about 80 words in 38 seconds. That makes about 2:40, with 20 seconds of slack under the 3:00 limit. The voice-over is spoken over the picture. Title cards are plain text on a dark background. The team lines are the user's own words.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:18 | The speaker on camera (or a title card: "Zeceipt — a receipt for one shielded Zcash payment") | "If your organisation pays people in shielded Zcash, proving one payment today means handing over your viewing key, and that shows every payment you have ever made. Zeceipt gives you a receipt for exactly one payment instead." |
| 0:18–0:44 | `1-console.webm`: raw 0–11.6 s, cut, raw 18.9–24.3 s (as in weekly update 1), then hold on "Broadcast" | "This is the console, on a local Zcash test chain. Five bounties in US dollars, typed in here or imported from a zecpay CSV, become one batch at Kraken's rate, fixed for the batch. I approve it, and the approval is bound to these lines and this rate. Then the Zkool wallet pays all five in one shielded transaction." |
| 0:44–1:04 | `2-receipts.webm` (5.6 s), then `3-receipt-page.webm` raw 0–3.6 s (VALID), holding on VALID | "When it confirms, I issue a receipt for each payment. Each receipt discloses the key to one output, and nothing else. The recipient opens their link, and their browser recovers their address, amount and memo from the transaction, in milliseconds, without contacting us." |
| 1:04–1:11 | `3-receipt-page.webm` from raw 3.6 s (INVALID, the stage named) | "Change one character, and it fails, and the page says where: here, the signature." |
| 1:11–1:34 | V2c: the batch page's "Download for OpenZcash (CSV)" and the file opened; then a terminal running `zeceipt pack` and `verify-pack` | "For the public, the batch downloads in the format OpenZcash's own export uses, with a receipt link on every row, so anyone can check a row. For an auditor, a pack of receipts replaces the viewing key. Its total is a lower bound, and it says so." |
| 1:34–1:48 | V2c: the payables page's zecpay import, the preview with each address, then Import | "It fits the tools teams already use. It reads Konclave's payroll file and zecpay's, and any payout tool can issue receipts by calling our library after it pays." |
| 1:48–2:02 | Title card: "Free issuer tier · team plans · verification API (planned)" and, below, "Next: a pilot with a real payer" | "We plan a free tier for issuers, paid team plans, and a verification API. Next: a pilot with a real payer, and receipts on a public chain." |
| 2:02–2:40 | The speaker on camera | The user's own two to four sentences: who you are, and why you are the ones to build this (`11_plan.md` §5, the 2:50 beat). |

## Choices that depend on the user's own steps

Say these only when they are true at the time of recording:
- **"The code is open source"**, after the repository is public (WBS 4.1.1.1). It could go at the end of the 1:48 line.
- **"Receipts are live on a public chain"**, only after the public-chain run (PROOF §6). If it has happened, it replaces "and receipts on a public chain" in the 1:48 line, and "local Zcash test chain" stays for the regtest footage.
- **"We've opened a pilot call on the Zcash forum"**, after the forum post.

## Do not say

- **"on mainnet" or "on testnet"** over this footage: every shot is regtest.
- **"automatically"** about these receipts: the footage shows the Issue receipts button.
- **"from the chain"** over the receipt page: it shows "Chain inclusion: Unknown", because the transaction was loaded from a file.
- **"never pays twice"**: after an uncertain outcome the console pays again only when nothing is mined past the attempt's expiry bound, and RSK-21 lists the cases that remain.
- **"audited"**: the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- **Solana, accounting exports, or a Konclave adapter**: dropped, or planned and not built.
- **"the only"** or **"nobody else"**: only Solana's auditor keys and Monero's proofs were checked (`11_plan.md` §6).
- **"users" or "customers"**: there are none yet.
