<!--
DRAFT, not posted (WBS 5.1.1.3; slice V1). Recording and posting are the user's: a one-minute video uploaded as the
Colosseum weekly update (Arena dashboard; needs the project registered there), due 2026-09-28; fallback: by 09-30, or skipped
(the updates are "not mandatory", strongly recommended; `11_plan.md` §8).
Official brief: "a concise, one-minute video highlighting progress and notable challenges from the previous week" (colosseum.com/hackathon).
Every claim is backed by the evidence named in `.trellis/tasks/09-26-weekly-update-1/implement.md`.
Footage: `../raw/demo/20260925230743/` (regtest only, recorded 2026-09-25 by `apps/console/test/shots/demo-video.ts`);
re-record with `ZECEIPT_REGTEST=1 node test/shots/demo-video.ts` after `next build` if the console changes before 09-28.
-->

# Weekly update 1 (week of 21–27 September): script and shot list

About 140 spoken words, for 60 seconds at about 2.3 words a second. The voice-over is spoken over the footage. The two title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:07 | Title card: "Zeceipt — week 1" and the line "A receipt for one shielded Zcash payment" | "I'm building Zeceipt: a receipt for one shielded Zcash payment, checkable on chain without your viewing key." |
| 0:07–0:27 | `1-console.webm` (25 s, played at 1.25×): five contributors, five bounties in dollars, one batch at Kraken's rate, approve, pay | "This week the whole payout path ran end to end on a local Zcash test chain. Five bounties in US dollars become one shielded batch at Kraken's live rate. I approve it, and it's paid through the Zkool wallet in one transaction." |
| 0:27–0:32 | `2-receipts.webm` (5.6 s, trimmed): confirmation, then five receipts | "Once it confirms, the console issues a receipt for every payment." |
| 0:32–0:38 | `3-receipt-page.webm` (6.5 s, trimmed): VALID, then one changed character gives INVALID | "The recipient verifies theirs in the browser. Change one character, and it fails." |
| 0:38–0:54 | Title card: "Challenge: matching a payment to its batch" | "The hardest bug: the wallet reports each address rebuilt from the note, so matching by address text missed multi-receiver addresses. A test with the old matching paid a restored batch twice. It now matches by receiver." |
| 0:54–1:00 | Title card: "Next: public-chain receipts and one pilot" | "Next week: receipts on a public chain, and one team paying a real batch." |

## If there's time to spare

- Replace the first card with the speaker on camera for the first sentence.
- If the forum pilot call is posted by then, add to the last card: "Pilot call on the Zcash forum."

## Do not say

- "on mainnet" or "on testnet": every shot is regtest, and the public-chain run waits on funding (`11_plan.md` §8).
- "audited": the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- Anything about Solana or accounting exports: they were dropped, or are planned and not built.
