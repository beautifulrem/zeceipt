<!--
DRAFT, not posted (WBS 5.1.1.3; slice V1). Recording and posting are the user's: a one-minute video, due 2026-09-28; fallback:
by 09-30, or skipped (the updates are "not mandatory", strongly recommended; `11_plan.md` §8).
Where to post: the FAQ does not say. The Arena API tracks `isCurrentWeekUpdateSubmitted` (`raw/colosseum_projects_frontier.json`),
so most likely the Arena dashboard, which needs the project registered; confirm there. Posting it on X tagging @colosseum as well is harmless.
Official brief: "a concise, one-minute video highlighting progress and notable challenges from the previous week" (colosseum.com/hackathon).
the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
Footage: `../raw/demo/20260925230743/` (regtest only, recorded 2026-09-25 by `apps/console/test/shots/demo-video.ts`);
re-record with `ZECEIPT_REGTEST=1 node test/shots/demo-video.ts` after `next build` if the console changes before 09-28.
-->

# Weekly update 1 (week of 21–27 September): script and shot list

About 130 spoken words, for 60 seconds at about 2 words a second. The voice-over is spoken over the footage. The two title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:07 | Title card: "Zeceipt — update 1 (21–27 Sep)" and the line "A receipt for one shielded Zcash payment" | "I'm building Zeceipt: a receipt for one shielded Zcash payment, checkable on chain without your viewing key." |
| 0:07–0:24 | `1-console.webm` at 1×: raw 0–11.6 s (keeping 1 s of "Paying…" so the press shows), cut, then raw 18.9–24.3 s (the tail is a static "Broadcast"), ending at 0:24.0. Cues: bounties at 0:09, the batch at the locked rate at 0:13, approved at 0:14.5, Pay pressed at 0:17.6, cut to "Broadcast" at 0:18.6 | "On a local Zcash test chain, five bounties in US dollars become one shielded batch at Kraken's live rate. I approve it, and it's paid through the Zkool wallet in one transaction." |
| 0:24–0:30 | `2-receipts.webm` (5.6 s, then hold): confirmed, Issue receipts, five receipts | "Once it confirms, the console issues a receipt for every payment." |
| 0:30–0:37 | `3-receipt-page.webm` (6.5 s, then hold): VALID, then one changed character gives INVALID | "The recipient verifies theirs in the browser. Change one character, and it fails." |
| 0:37–0:53 | Title card: "Challenge: matching a payment to its batch" | "The hardest bug: the wallet reports only the part of each address that was paid, so matching the full address missed some payments, and a test paid a restored batch twice. Now it matches that part." |
| 0:53–1:00 | Title card: "Next: public-chain receipts and one pilot" | "Next week: receipts on a public chain, and one team paying a real batch." |

## If there's time to spare

- Replace the first card with the speaker on camera for the first sentence.
- If the forum pilot call is posted by then, add to the last card: "Pilot call on the Zcash forum."
- Recorded on 09-30 or later (the fallback date): the testnet receipts exist (PROOF §6), so the last card reads "Next: mainnet receipts and one pilot", and its line "Next: receipts on mainnet, and one team paying a real batch." (two words shorter).

## Do not say

- "on mainnet" or "on testnet" over the footage: every shot is regtest. The testnet run of 09-30 (PROOF §6) is not in this footage, and zeceipt has no mainnet receipt.
- "audited": the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- Anything about Solana or accounting exports: they were dropped, or are planned and not built.
- "automatically" about the receipts in this footage: this recording issues them with the Issue receipts button (the automatic worker is PROOF §5g, not on screen).
- "from the chain" over the receipt page: it shows "Chain inclusion: Unknown: the transaction was loaded from a file", because no public node serves regtest.
