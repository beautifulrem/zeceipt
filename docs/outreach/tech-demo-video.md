<!--
DRAFT (WBS 5.1.1.2; appraisal round 1, D17 and D23). Rewritten 2026-09-30 for the pivot: the full control challenge, from the reviewer's nonce to a green
case page, then a tampered copy in red. The receipts-and-console script is in git history.
Official brief: a product demo of at most 3 minutes, in English (KB `04_submission.md`); real product use with narration (KB `11_strategy.md` §六).
Owner-only: the wallet send (it uses the owner's testnet wallet; never show `zcash-devtool`'s identity file, the mnemonic, or any path to them on screen),
the narration, and the upload.
Footage conventions (new, 2026-09-30): screen-record the live pages (https://beautifulremi.dpdns.org/zeceipt/case/ and /build/) and a terminal directly;
1440×900, light theme, a clean browser profile; terminal at 18 pt with the prompt reduced to `$`. Record each step as its own clip, then narrate over the cut.
NU7 DEADLINE: NU7 activates on testnet on 2026-10-06. A challenge transaction made after activation is refused by this build (the Zcash crates do not
know NU7's branch yet), so the wallet send (0:30 row) must be mined on testnet BEFORE 10-06. If it is not, use the fallback in "If the send misses 10-06".
Every sentence is backed by `spec/dossier-v1.md` §7, `docs/PROOF.md` §8 and the tests, checked claim by claim before writing.
-->

# Technical demo (≤ 3:00): script and shot list

About 305 words of voice-over in 2:40 (1.7 to 2.3 words a second per row), with 20 seconds of slack. The whole demo is one real challenge on **Zcash testnet**: say "testnet" once at the start. Rows marked **owner-only** need the owner's wallet or voice; the voice-over itself is the owner's in every row.

| Time | Picture | Voice-over |
|---|---|---|
| 0:00–0:12 | Title card: "Zeceipt: a source-of-funds dossier, with a live control challenge (Zcash testnet)" | "This is one complete challenge on Zcash testnet: a reviewer asks a holder to prove they control some shielded funds, and checks the answer." |
| 0:12–0:30 | The case page, "Challenge the holder": "Generate a nonce", the nonce shown; the owner copies it into a note. Alternative take: terminal `zeceipt dossier nonce --json --testnet`, printing the nonce with the chain height it was issued at (if that flag is in the release) | "The reviewer starts. They generate a nonce, a random challenge, and write it in the case file with the time and the chain height. Then they send it to the holder." |
| 0:30–0:55 | **Owner-only.** Terminal: the owner's testnet wallet sends 0.001 TAZ to its own address with the nonce as the memo (`zcash-devtool wallet send … --memo <nonce>`; crop the identity path out of frame, or type it off screen). Then the transaction id, and a block explorer or `zeceipt verify --testnet` showing it mined | "The holder answers from the wallet that holds the funds: a small payment to their own address, with the nonce as the memo. The transaction spends the notes being explained. Only someone who can spend them can make it, which a viewing key cannot do." |
| 0:55–1:25 | The build page: the published testnet UFVK pasted (`fixtures/testnet/issuer-ufvk.txt`: public on purpose, it is the demo account's), "Find my transactions" from 4,419,900, the list filling in (it includes the new challenge transaction: "Build" says it answers a challenge, and "Move it to Control and build again" fills "The reviewer's nonce" and "The challenge transaction's id" from its memo in one click; or fill those two fields first, and the scan leaves it out); the summary (notes, receipts, claims) and "Download dossier.json" | "The holder builds the dossier in the browser. Find my transactions scans compact blocks with the viewing key, here in the page, and the key is never sent anywhere. Add the nonce and the challenge transaction, and the builder assembles the claims: where the funds came from, how they moved, what was paid, and the control answer." |
| 1:25–1:55 | The case page with the new dossier opened: amber, "Claims verified — control not shown", and the nonce line naming only "a nonce beginning zeceipt-challenge-…"; paste the reviewer's nonce from the case note into "Nonce you issued" (and H₀): green, "Verified, with control"; scroll the timeline to the control claim, which names the nonce and the spent note's value; open "What was disclosed" | "The reviewer opens it. Every claim is checked in their browser against a public testnet node: the notes open, their nullifiers are in the transactions that spent them, and the control claim answers this reviewer's nonce, in a transaction that spent the disclosed notes. The report lists what the holder disclosed: note openings and a nullifier key, never the viewing key." |
| 1:55–2:15 | Same page: edit the dossier's nonce by one character and check again: control fails, "not the one you issued". Then a copy with one path claim removed: amber, "Claims verified — funds not fully explained", naming the note no longer traced to an origin | "Now tamper with it. Change one character of the nonce, and control fails: this answer was for another challenge. Remove a link of the history, and the case turns amber: funds not fully explained. That is the check against mixing, a small clean note vouching for a large deposit." |
| 2:15–2:30 | Terminal: `zeceipt dossier verify dossier.json --testnet --expect-nonce <nonce>` and its last lines (`all_verified: true`, `controlled: true`), then `zeceipt dossier serve` answering the same dossier with `curl` (`docs/api/dossier-service.md`) | "A back office gets the same checks from the command line, or from a small HTTP service on its own node, and files the JSON report with the dossier's hash." |
| 2:30–2:40 | Title card: "Proves: spend authority after your nonce. Does not prove: unspent now · identity · anything before the origin" | "It proves the holder could spend these funds after the nonce. It does not prove they are unspent now, or who anyone is." |

## If the send misses 10-06

After NU7's testnet activation, a new challenge transaction cannot be read until the Zcash crates release NU7 support (`docs/RELEASING.md` §1). Then:
- the 0:30 row shows `docs/PROOF.md` §8's recorded challenge instead (`10e941e7…6e43`, mined at 4,421,345 on 2026-09-30), with the nonce `zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8`, and the voice-over says "recorded on the 30th of September";
- the 0:12 row generates no new nonce: it shows that nonce as the one in the case file;
- the 0:55 row builds with that nonce and control transaction (it reproduces the committed testnet dossier);
- the rest stands.

## Do not say

- **"mainnet"**: every step is testnet (TAZ).
- **"a real exchange"** for the exchange sample: say "a simulated exchange-deposit review on testnet (we ran the exchange's wallet)" (PROOF §9); its nonce was issued by us.
- **"the reviewer can see nothing else"**: `nk` lets them see when the disclosed notes are later spent, and the openings show addresses (spec §8). Say "never the viewing key".
- **"proves the funds are still there"**: control is at the challenge's height (spec §7.2).
- **"a signature"** for the control answer: it is a transaction; a signature standard for Ironwood does not exist yet.
- **"works after NU7"**: see the NU7 note above.
- **The wallet's identity file, mnemonic or their paths**, on screen or in the narration.
- **"audited"**: self-review only (`docs/SECURITY_REVIEW.md`).
