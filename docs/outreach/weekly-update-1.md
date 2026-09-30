<!--
SKIPPED: not posted, recorded as skipped on 2026-09-30 (WBS 5.1.1.3; slice V1). Recording and posting were the user's: a one-minute
video, due 2026-09-28; fallback: by 09-30, or skipped (the updates are "not mandatory", strongly recommended; `11_plan.md` §8). The
fallback date passed unposted, and PM round 3 (P09) recommended skipping it over posting footage of the old UI. Weekly update 2
(`weekly-update-2.md`, due 10-05) is the next. Kept as written; if the owner posts it after all, the cues below are on the new take.
Where to post: the FAQ does not say. The Arena API tracks `isCurrentWeekUpdateSubmitted` (`raw/colosseum_projects_frontier.json`),
so most likely the Arena dashboard, which needs the project registered; confirm there. Posting it on X tagging @colosseum as well is harmless.
Official brief: "a concise, one-minute video highlighting progress and notable challenges from the previous week" (colosseum.com/hackathon).
Every sentence is backed by the evidence in `docs/PROOF.md`, the tests and `docs/product/10_research_log.md`, checked claim by claim before writing.
Footage: segments 1–3 of take `20260930083345` (`../raw/demo/20260930083345/`, regtest only, re-recorded 2026-09-30 after the UI changes of
09-29 and 09-30; cue sheet `docs/outreach/footage-20260930.md`). Cue times are video times, checked on that take's frames on 2026-09-30.
-->

# Weekly update 1 (week of 21–27 September): script and shot list

About 130 spoken words, for 60 seconds at about 2 words a second. The voice-over is spoken over the footage. The two title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:07 | Title card: "Zeceipt — update 1 (21–27 Sep)" and the line "A receipt for one shielded Zcash payment" | "I'm building Zeceipt: a receipt for one shielded Zcash payment, checkable on chain without your viewing key." |
| 0:07–0:24 | `1-console.webm` at 1×: raw 0–12.8 s (keeping 1 s of "Paying…" so the press shows), cut, then raw 25.4–29.6 s (the tail is a static "Broadcast"), ending at 0:24.0. Cues: bounties at 0:09.8, the batch at the locked rate at 0:14.3, approved at 0:15.8, Pay pressed at 0:18.8, cut to "Broadcast" at 0:19.8 | "On a local Zcash test chain, five bounties in US dollars become one shielded batch at Kraken's live rate. I approve it, and it's paid through the Zkool wallet in one transaction." |
| 0:24–0:30 | `2-receipts.webm` (5.7 s, then hold): confirmed, Issue receipts, five receipts | "Once it confirms, the console issues a receipt for every payment." |
| 0:30–0:37 | `3-receipt-page.webm` (7.0 s): VALID, then one changed character gives INVALID (from raw 4.2 s, 0:34.2) | "The recipient verifies theirs in the browser. Change one character, and it fails." |
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
