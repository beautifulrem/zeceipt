# What to do next, 2026-09-29 → 10-12, in four levels (slice RS7)

This breaks the remaining work into four levels: **area → slice → step → check**. The research behind it is `[R132]`, read in Google Chrome on 2026-09-28. It covers:
- Monero's transaction, spend and reserve proofs;
- ZIP 315's confirmation policy;
- ZIP 311;
- BIP-322's result states.

The earlier records it builds on are:
- the solo schedule, `11_plan.md` §8;
- NU7's dates, `[R128]`;
- the testnet rehearsal, `[R126]`;
- today's hardening (`docs/SECURITY_REVIEW.md`).

Each slice runs as before: a PRD, the work, and an independent review until it scores 100. Items marked **U** are the user's and are listed only so the order is visible. Dates follow `11_plan.md` §8. Where they differ, §8 governs.

## Decisions taken from the research

1. **Report depth, not only the height.** Monero's `check_tx_proof` returns `confirmations` and `in_pool` alongside `good` and `received`. ZIP 315 says sent and incoming transactions SHOULD be reported with their number of confirmations. It recommends 10 confirmations for funds from an untrusted party and 3 for trusted ones. Zeceipt's receipt page said it "does not count confirmations" until slice A2. The CLI already has `GetLatestBlock`, and the chain tip is available over gRPC-web: it was measured from `zjs.zec.rocks` on 09-28. So the verifier can report `confirmations = tip − height + 1`: Zcash's convention, where "confirmations are one more than the depth" (Zebra's `zebra-rpc` `methods.rs`, after zcashd's `getblock`). Monero counts the blocks mined after the transaction, one fewer. The verifier can also say what ZIP 315 recommends: 10 confirmations before spending funds from an untrusted sender. Area A.
2. **Say what a proof does not settle.** Monero's docs warn that transaction proofs "do not guarantee that funds associated with a proof are spendable". A receipt likewise shows that an output was paid. It does not show that the note is still unspent, or that whoever presents the receipt can spend it. The receipt's `does_not_prove` gains that. Area A.
3. **Keep the three-state outcome.** BIP-322 defines `valid`, `invalid` and `inconclusive` ("the validator was unable to check"), and adds "valid at time T and age S" for timelocks. Zeceipt already separates `pending` (the transaction is not found) from `invalid` (spec §4). No change is needed; the plan keeps that separation, and the depth work must not merge the two. Area A.
4. **Versioned formats with vectors, as the mature proofs have.** Monero's proofs are versioned strings (`InProofV1`, `SpendProofV1`, `ReserveProofV1` on the page read). BIP-322 ships test vectors in several implementations. Zeceipt has `zeceipt-v0` and committed vectors. Any field added by A is optional, and outside the signed bytes (spec §5), so v0 receipts and vectors are unchanged. Area A.
5. **The lower bound, as Monero's reserve proof has it.** Monero reports `total` and `spent` for a reserve. The audit pack's total is a lower bound, now counting each output once (slice U4). Showing whether each output is spent needs the recipient's viewing key, so it stays out of scope. The pack says "a lower bound", and it stays that way.

## A. Verification depth and wording (engineering, planned for 10-01 → 10-03's slack)

Area A is new scope. It is planned for the slack §8 leaves in 10-01 → 10-03 (0.45 pd). When it started (09-28), it got an unpriced WBS leaf, 3.2.3.5. Being unpriced, it has no §8 line; §8 schedules priced leaves only, and records work done early in its paragraph. It must land before the 10-10 freeze on `crates/`, `packages/verify/pkg` and `spec/`. If the slack is gone, A waits until after the submission, and nothing else here depends on it except B2.2's optional confirmations.

Progress: A1 done 2026-09-28 (with per-endpoint timeouts, A1b); A2 done 2026-09-28 (with the verdict before the tip, A2b); A3 done 2026-09-28 (with one node path, A3b); A4 done 2026-09-28. Area A is complete.

- **A1. The chain tip over gRPC-web** in `@zeceipt/verify`.
  - **A1.1** `fetchChainTip(network, endpoints)`: a hand-encoded `GetLatestBlock(ChainSpec{})` to the same endpoints as `fetchRawTx`, with the same failover.
    - Check: a unit test with a mocked response, in the style of `verify.mjs`'s `fetchRawTx` tests. It covers failover, and an empty or garbled response giving a clear error.
    - Check: a live probe against `zjs.zec.rocks/testnet` and `/mainnet` returns a height at or above a fixture's height.
  - **A1.2** A `confirmations(height, tip)` helper that returns `tip − height + 1`, and `null` when either is unknown or the tip is below the height (a reorg or a lagging node).
    - Check: tests for 1 at the tip, `null` for a lagging tip, and `null` for mempool.
  - **A1.3** Types in `index.d.ts`, and README API rows.
    - Check: the export-to-README drift check (the one run on 09-28) finds no gap.
- **A2. The receipt page shows depth.**
  - **A2.1** After a node fetch, ask the same node for the tip. Show "Mined at height H, N confirmations, according to <node>". Beside it: "ZIP 315 recommends 10 confirmations before spending funds from an untrusted sender".
    - Check: page e2e with mocked gRPC-web for both calls; the copy is shown, with no CSP violation.
    - Check: when the tip fails, the page keeps "Mined at height H" and says depth is unknown. It never shows an invalid verdict.
  - **A2.2** File-loaded transactions keep "Chain inclusion: Unknown". No request is made.
    - Check: the existing "no request before the click" e2e still passes.
- **A3. The CLI reports depth.**
  - **A3.1** `zeceipt verify` adds `confirmations` next to `height` in its JSON, from `GetLatestBlock` on the same endpoint.
    - Check: CLI tests for the offline case (no field) and a mocked node. PROOF §5's transcript is left as recorded.
  - **A3.2** The exit codes are unchanged: 0 valid, 1 invalid, 2 pending, 3 usage.
    - Check: the existing exit-code tests pass.
- **A4. `does_not_prove` gains "that the output is still unspent, or that whoever presents the receipt can spend it"** (decision 2).
  - **A4.1** Change the WASM string and the CLI's copy, then rebuild the WASM reproducibly and update the README hash.
    - Check: `verify.mjs` asserts the new text. `build_wasm.sh --check --require-identical-wasm` passes.
  - **A4.2** The same sentence goes in spec §4 ("What verification proves"), the page's "What it does not prove" and the pitch's "Do not say" list.
    - Check: a grep finds every copy, and they agree.

## B. Public-chain evidence (Must 6: scheduled 09-27 → 09-30 in §8; cut-off 10-02 in RSK-3; hard limit 10-06, when NU7 activates on testnet `[R128]`)

- **B1. U: the faucet claim.** PROOF §4 has the fauzec API command, which needs no human check "for now" `[R126]`.
  - **B1.1** U decides and claims. The drip is spendable after 10 confirmations, about 12.5 min.
    - Check: `wallet balance` shows it as spendable.
- **B2. The testnet run,** following PROOF §4.
  - **B2.1** Generate the recipient account, then make three sends, `INV-T-001` to `INV-T-003`, each waiting for its change to confirm.
    - Check: three txids, mined before 2026-10-06 `[R128]`.
  - **B2.2** `zeceipt issue --testnet … --host`, then `verify --testnet --require-signature` for each receipt, and one tampered copy.
    - Check: exit 0 three times with heights (and, after A3, confirmations); exit 1 for the tamper.
  - **B2.3** Open one receipt link on the page, which fetches from `zjs.zec.rocks/testnet` with ChainSafe's as the fallback.
    - Check: VALID, mined at the recorded height.
- **B3. Records.**
  - **B3.1** PROOF §6 is written as a testnet entry, with no OCK. RSK-3 and the checklist's "public chain" lines are updated.
    - Check: both checkers pass. The videos' conditional rows ("If the public-chain run has happened") are applied.

## C. Release v0.1.0 (the tag on 10-09, after the security rerun)

- **C1. The pre-tag checks** (`docs/RELEASING.md`).
  - **C1.1** Check crates.io for a NU7-capable `zcash_protocol`. If one is released, U1c runs first (RELEASING's list); if not, the tag ships with the NU7 limitation.
    - Check: the version found is recorded, and the release notes match.
  - **C1.2** `check_release.py --tag v0.1.0`, `build_wasm.sh --check --require-identical-wasm`, and the full test suites.
    - Check: all pass.
- **C2. The security rerun** (WBS 3.4.2.3, 10-08).
  - **C2.1** `scripts/security_review.sh`, recorded as its own dated section.
    - Check: exit 0, or each finding fixed or accepted with its reason.
- **C3. The changelog and the tag.**
  - **C3.1** `Unreleased` becomes `0.1.0`, dated 10-09; the tag is annotated.
    - Check: `check_release.py --tag v0.1.0` passes on the tagged commit.
- **C4. U: the push, and the first CI run.** A failing first run is fixed as its own slice.
  - Check: CI is green, including the featureless `cargo check` (slice G1).
  - Done 2026-09-29: the repository is public at `github.com/beautifulrem/zeceipt` (Apache-2.0). The first run failed 20 console tests, because the step passed a relative `ZECEIPT_BIN`, which the configuration refuses. The fix is 2518462, and the second run is green: 65 Rust tests, 459 console tests, 17 page e2e and 26 app e2e. On the runner's clang 18, the wasm-bindgen outputs are identical and the `.wasm` differs (sha256 `59b3a12e…`), as the README's reproducibility note allows.
- **C5. U: `npm publish @zeceipt/verify`, on 10-10,** after C2.
  - Check: `test:pack` passes on the tarball that is published.

## D. Submission (10-04 → 10-11)

- **D1. U: the videos** (10-04 → 10-07), from the scripts in `docs/outreach/`.
  - **D1.1** Apply the conditional rows, using B's outcome and the repository's visibility.
    - Check: no "Do not say" item is spoken. That includes "NU7 is live": on 10-04 it is not, and from 10-06 it is live on testnet only.
- **D2. Weekly update 2** (U records it on 10-05; the script is ready).
  - Check: the lines that depend on B are applied.
- **D3. The description and GTM placeholders** (5.1.2.2).
  - **D3.1** Fill them from the facts at the time: public-chain receipts (B), the pilot (U), and the test counts.
    - Check: the word count and the checklist agree.
- **D4. Freeze, and the final submission** (10-10 → 10-11).
  - Check: every link resolves, and the form's claims match PROOF.

## E. Watches (each run is a small slice, recorded in the research log)

- **E1. A NU7-capable `zcash_protocol`** on crates.io. It is 0.10.6 on 09-28. If released: U1c, then C1.1.
- **E2. Zebra's NU7 release** ("the next release … should support NU7") and the Zkool fork. Either changes RSK-14's pay-path note.
- **E3. A weekly competitor rescan,** next around 10-05. It covers new Zcash repositories since 09-28, as in slice RS6.
- **E4. The 3.3.4.4 NU7 re-test on testnet,** after activation on 10-07. Expected: a post-activation transaction is refused by name, and pre-activation receipts keep verifying `[R128]`.
