<!--
DRAFT (WBS 5.1.1.1; appraisal round 1, D23). Rewritten 2026-09-30 for the pivot to source-of-funds dossiers; the receipts-and-console script is in git history.
Official brief: a presentation (pitch) video of 2 to 3 minutes, in English, uploaded to a platform such as YouTube (KB `04_submission.md`);
the product demo is a separate video of at most 3 minutes (`tech-demo-video.md`).
Owner-only: recording the voice-over, the on-camera rows, the team line and the upload. Recording window 10-08 → 10-09 (`docs/product/08_gtm_pricing.md` §2).
Footage conventions (new, 2026-09-30): the live pages may be screen-recorded directly (https://beautifulremi.dpdns.org/zeceipt/case/#sample and /build/),
in a clean browser profile at 1440×900, light theme, no extensions visible; record the screen first and cut to the voice-over. No console or regtest
footage: the take `20260930083345` (`footage-20260930.md`) belongs to the building blocks and is not used here.
Before recording: open the sample and confirm "All 12 claims verified" (not a stale deploy, RELEASING §6). After 10-06 (NU7 on testnet), confirm the sample
still verifies live; it should, since its transactions predate activation. Every sentence is backed by `docs/PROOF.md` §8, the spec, `docs/product/08_gtm_pricing.md`
and `docs/product/10_research_log.md` (R137, R138), checked claim by claim before writing.
-->

# Pitch video (≤ 3:00): script and shot list

About 305 scripted words in 2:40 (1.7 to 2.1 words a second per row), then the owner's own ask and team line, about 40 words in 20 seconds: 3:00 in all. Rows marked **owner-only** are the owner on camera or in their own words; every other row is voice-over (also the owner's voice) over a screen recording or a title card. Title cards are plain text on a dark background.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:20 | **Owner-only**: the owner on camera. Or a title card: "$589,000 held for 67+ days" over the forum thread's title (screen recording of forum.zcashcommunity.com/t/57497, scrolled to the first post) | "One Zcash holder swapped shielded ZEC through a cross-chain service. Five hundred and eighty-nine thousand dollars has been held for more than sixty-seven days. To get it back, he sends screenshots and transaction hashes, because nothing better exists." |
| 0:20–0:40 | Title card, two lines appearing in turn: "1. Deshield: everything after it is public." "2. Hand over the viewing key: every past and future payment." | "Exchanges ask shielded holders where their funds came from. Today there are two answers. Deshield first, and everything after it is public. Or hand over your viewing key, and the reviewer sees every payment you have ever made, and every future one." |
| 0:40–1:05 | Screen recording of the build page: the published testnet UFVK (`fixtures/testnet/issuer-ufvk.txt`, public by design) pasted, "Find my transactions" run, the found transactions listed, then the built dossier's summary and "Download dossier.json" | "Zeceipt is a third answer: a dossier. The holder builds it in the browser, and the viewing key never leaves the page. It discloses the notes the case is about, the payments made from them, and a nullifier key that can link one note to the next, and nothing else." |
| 1:05–1:35 | Screen recording of `case/#sample`: the page loads and checks; "All 12 claims verified" appears; scroll slowly through the funds-flow timeline (origin, hops, the three payments, control) and stop on the control claim; hover the dossier's sha256 | "The reviewer opens it, and every claim is checked in their browser against the chain. This is a real dossier on Zcash testnet. The funds arrived from a faucet, moved through four hops, paid three invoices, and then the holder answered the reviewer's challenge on chain: a transaction that only someone who can spend these funds could make." |
| 1:35–1:55 | Same page: "Check another dossier" (or the JSON editor), change one character of the nonce, check: the control claim turns red; restore, change one byte of `nk`, check: eleven claims fail, the origin reads "Not proven" | "Change one character of the challenge, and control fails. Change one byte of the key, and every claim that depends on it fails, while the rest still verify. A forged dossier fails at the claim it lies about." |
| 1:55–2:15 | Title card: "It does not prove: who the counterparties are · anything before the first origin · that funds are unspent now · anything legal" | "What it does not prove, it says, in every report: who the counterparties are, what happened before the first disclosed origin, or that the funds are unspent today. It is evidence a reviewer weighs, not a certificate." |
| 2:15–2:40 | Title card: "Holders: free · Browser review: free · API: $5 a verified dossier · Self-hosted with support: $12,000 a year" and, below, "vs. an estimated $120–$960 of analyst time per manual case" | "Holders never pay. Reviewers check in the browser for free, and pay for the API or a self-hosted service with support, priced against the analyst hours a manual source-of-funds case costs. It runs on testnet today, and the code is open source." |
| 2:40–3:00 | **Owner-only**: the owner on camera | The owner's own words, about 40: the ask ("If you review shielded deposits, or help someone whose deposit is held, check one dossier and tell us what is missing: the link is below") and one sentence on who they are. |

## Lines that depend on the day

Say these only when they are true at the time of recording:
- **"A reviewer at … has checked one"**: only with a named reviewer's consent (`08_gtm_pricing.md` §6); it replaces the 2:15 row's last sentence.
- **"and on mainnet"**: only if a mainnet dossier exists (PROOF §8 has testnet only on 09-30).
- **Transparent cash-outs**: if the `transparent_payment` claim is committed and on the live page by the recording, add to the 1:05 row: "and a cash-out to an exchange's transparent deposit address is a claim too".
- **The pilot call**: "we've asked reviewers on the Zcash forum" only after `forum-pilot-post.md` is posted.

## Do not say

- **The holder's name** (timtech) or "our user": he is not a pilot, and has not consented. The thread is public; the number and duration are his public statements (/t/57497, 09-25).
- **"proves where the money came from"** without the limit: it proves where the disclosed funds entered the holder's wallet and how they moved; the counterparties' identities are not proven.
- **"proves the funds are there" / "unspent" / "proof of reserves"**: control proves spend authority at the challenge's height, nothing after it (spec §4, §7.2).
- **"approved by regulators"**, **"a compliance standard"**, **"exchanges accept it"**: no exchange, regulator or reviewer has accepted a dossier yet.
- **"customers"** or **"users"**: there are none yet.
- **"mainnet"** over the sample: it is testnet (TAZ).
- **"no one else does this"** or **"the only"**: viewing-key exports, Railgun's and Privacy Pools' association-set proofs and Monero's reserve proofs are related work (`docs/PRIOR_ART.md`); say what differs instead.
- **The prices as a quote**: they are a draft to test with reviewers; say "priced against", not "costs".
- **"audited"**: the security work is a self-review (`docs/SECURITY_REVIEW.md`).
- **"works after NU7"**: from mainnet activation on 11-05, new transactions are refused until the crates release NU7 support; say it only once that release has shipped.
