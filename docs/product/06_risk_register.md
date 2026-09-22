# Risk register

Likelihood/impact: L/M/H. Owner roles as in the WBS. Trigger = the observable that activates the mitigation.

| ID | Risk | L | I | Mitigation | Trigger / status | Owner |
|---|---|---|---|---|---|---|
| RSK-1 | Konclave (active, has users) adds receipts and is judged the "real" product in the same track | M | H | Ship the format, vectors and the Konclave CSV adapter first; pitch Zeceipt as the proof layer for vaults; keep the regtest/UFVK proof visible | Konclave repo mentions "receipt"/"ock"; weekly rescan | PM |
| RSK-2 | ZCG #437 receipts SDK is funded and treated as canonical | M | M | Align field names; post v0 + vectors to zips #387 by 2026-09-27; freeze `zeceipt-v0` id, keep ZIP alignment in `zip311_profile` | #437 status changes | R |
| RSK-3 | No public-chain evidence by submission | M | H | Regtest proof done; testnet needs a human faucet claim (PROOF §4) and mainnet receipts need ≈ 0.02 ZEC (WBS 3.4.1.5, due 2026-09-26); if impossible, present regtest + mainnet-read honestly and drop the ≥ 15 metric from the pitch | **2026-09-25** without testnet funds or a mainnet funding commitment (leaves 10-01 first pilot batch reachable) | U/PM |
| RSK-4 | Zkool GraphQL behaves differently on Ironwood mainnet than on regtest (memos, pools) | M | M | Test on testnet as soon as funded; Zallet backend and ZIP-321 manual backend as fallbacks | first testnet batch fails | R |
| RSK-5 | Internal-scope OVK does not open change outputs (observed on regtest) | H (observed) | L | Not needed for recipient receipts; investigate devtool change key handling; document | already observed | R |
| RSK-6 | Payout console scope (17 requirements) does not fit the remaining days | H | M | Cut order: notifications → reconciliation view → Zallet backend → OpenZcash demo; keep Must set minimal; console can ship with Zkool only | 2026-10-03 status review | T |
| RSK-7 | Solana attestation slips and accelerator eligibility weakens | M | M | Minimal program (one instruction, PDA) budgeted at 1 day; 1Click leg as half-day fallback | 2026-10-03 | R |
| RSK-8 | Public lightwalletd/gRPC-web endpoints down during demo | L | M | Endpoint failover lists; offline mode with raw tx files; regtest node runbook | endpoint errors | R |
| RSK-9 | Judges read "receipt" as a ZIP, not a company | M | M | Business section: seats + verification API + licensing; pilots; countable metrics | interview questions | PM |
| RSK-10 | EU AMLR framing hurts the impact story | L | M | Position selective disclosure as the compliance enabler; cite TRM category | judge asks about regulation | PM |
| RSK-11 | Receipt over-disclosure (address linkability) criticised | M | L | Spec §9 guidance; console fresh-diversifier warning (REQ-CON-6) | reviewer question | PM |
| RSK-12 | Hosted verifier privacy (node learns txid) criticised | M | L | Disclosure on the page; CLI block-range mode planned (REQ-CLI-7) | reviewer question | R |
| RSK-13 | Repository not pushed → CI never ran, links dead | H (now) | M | User action; README states it plainly until done | 2026-09-24 | U |
| RSK-14 | NU7 testnet activation (2026-10-06) changes something we rely on | L | M | v6 format unchanged per ZIP 258; re-run tests on testnet after activation | 2026-10-06 | R |
| RSK-15 | Team/FMF information missing in the pitch | H (now) | H | User supplies names and two sentences; template in `11_plan.md` §5 (pitch 2:50) and `09_submission_checklist.md` §2 "Team" | 2026-09-24 | U |
| RSK-16 | Submission window opens on a different day than assumed | M | L | Confirm on 2026-09-22 via Discord/FAQ; shift upload day only | window announcement | U |
| RSK-17 | Dependency vulnerability or supply-chain issue in pinned crates | L | M | `cargo audit` before submission (WBS 3.4.2.3); pinned versions | audit output | R |
| RSK-18 | Stop-loss: Ironwood recovery failure was the kill criterion; now passed | — | — | Closed on 2026-09-22 (regtest proof) | — | — |
| RSK-19 | Single-operator capacity: the plan's baseline assumes two people; headcount is unconfirmed (WBS 2.4.3.3) and every commit so far has one author | H | H | `11_plan.md` §2 solo branch (scope that fits ≈ 15 person-days) applied from day one if the roster is not confirmed by 2026-09-24; AI-assisted implementation is the working assumption but is not counted as capacity | 2026-09-24 without a confirmed second person; re-check 2026-09-26 | U/PM |
