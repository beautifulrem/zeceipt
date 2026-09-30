<!--
DRAFT, not posted (WBS 5.1.1.5; slice WU2b). Recording and posting are the owner's: a one-minute video, due 2026-10-05; fallback:
by 10-07, or skipped (the updates are "not mandatory", strongly recommended; `11_plan.md` §8). Update 1 was skipped on 2026-09-30, so this is the first posted:
most likely on the Arena dashboard (`weekly-update-1.md`).
Official brief: "a concise, one-minute video highlighting progress and notable challenges from the previous week" (colosseum.com/hackathon).
Rewritten 2026-09-30 for the pivot to source-of-funds dossiers (appraisal round 1, D23); the receipts-era script (export, pack, testnet receipt) is in git history.
Owner-only: the narration and the posting.
Footage conventions (new, 2026-09-30): the live pages are screen-recorded directly (https://beautifulremi.dpdns.org/zeceipt/case/#sample), 1440×900, light theme,
a clean browser profile. The NU7 clip is `10-nu7-refusal.webm` from `../raw/demo/20260928091704/` (no chain, no UI: the committed batch transaction and a copy
with NU7's branch id; `apps/console/test/shots/nu7-refusal.ts`; its first frame is white, cue from 0.1 s). Before recording, apply "Rows that depend on the week".
Every sentence is backed by `docs/PROOF.md` §8, `docs/product/13_pivot.md` and `docs/product/10_research_log.md` (R137, R138), checked claim by claim before writing.
-->

# Weekly update 2 (week of 28 September to 4 October): script and shot list

About 135 spoken words in 60 seconds (1.8 to 2.4 words a second per row). The voice-over is spoken over the footage. Title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:06 | Title card: "Zeceipt — update 2 (28 Sep–4 Oct)" and the line "Source-of-funds evidence for shielded Zcash" | "Zeceipt, update two. This week we changed what we are building." |
| 0:06–0:20 | Title card, three lines appearing in turn: "Exchanges ask shielded holders for the source of funds" · "Answers today: deshield, or hand over the viewing key" · "Per-payment receipts: crowded; ZCG declined a standalone one on 09-30" | "Exchanges ask shielded holders where their funds came from, and today's answers give up their privacy. Per-payment receipts, our first product, were a crowded space, so they became a building block." |
| 0:20–0:40 | Screen recording of `case/#sample`: "All 12 claims verified", the funds-flow timeline, the control claim; then one character of the nonce changed, and the control claim fails | "The product is a dossier: claims about specific funds, where they came from and how they moved, and a challenge showing the holder can spend them. A reviewer checks each claim in the browser. This one is real, on testnet. Tamper with it, and it fails." |
| 0:40–0:54 | `10-nu7-refusal.webm` (take 20260928091704): 0.1–4.1 s, the transaction as it is; from 4.1 s, the same bytes with NU7's branch id, refused by name. The on-screen comment says the second file is a stand-in | "This week's challenge: the NU7 upgrade reaches testnet on the sixth. Until the Zcash crates support it, we refuse its transactions by name. Our dossiers predate it, and keep verifying." |
| 0:54–1:00 | Title card: "Next: cash-outs to transparent addresses · reviewer pilots" | "Next: exchange cash-outs, and reviewers to try it. The code is open source." |

## Rows that depend on the week

Say these only if they are true when recording. Each replaces a sentence of the row named, keeping the total at about 60 seconds.

- **The pilot call is posted** (`forum-pilot-post.md`): the 0:54 row can say "we've asked reviewers on the Zcash forum to try it".
- **A reviewer checked a dossier**: one sentence in the 0:54 row, naming them only with their consent, otherwise "one reviewer".
- **The transparent payment claim is committed and live**: the 0:54 row says "Cash-outs to exchange deposit addresses are in. Next: reviewers to try it."
- **NU7 support shipped** (a `zcash_protocol` release, then ours): replace the 0:40 row's last two sentences with "Our crates now support it."
- **NU7 activated before the recording** (10-06, if the recording slips past the due date): "activated on testnet on the sixth", and re-check the sample live first.

## Do not say

- **"NU7 transaction"** without saying it is a stand-in: the clip's second file is a real transaction's bytes with the branch id changed, not consensus-valid. "Its transactions" in the voice-over refers to the upgrade, and the on-screen comment says what the file is.
- **"NU7 is live"** before 10-06, or **"supports NU7"** before a release does.
- **"mainnet"** over the sample: it is testnet.
- **"ZCG rejected us"**: ZCG declined another team's receipts application (#437); zeceipt has not applied.
- **"customers"**, **"users"**, **"exchanges accept it"**: no reviewer has accepted a dossier yet.
- **"audited"**: the security work is a self-review (`docs/SECURITY_REVIEW.md`).
