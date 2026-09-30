<!--
DRAFT, not filed (appraisal round 1, D30). Filing is the owner's decision: public issues from the owner's GitHub account on
zodl-inc/zodl-ios, zodl-inc/zodl-android and zingolabs/zingolib (or zingolabs/zingo-mobile). Target date 10-02 (`docs/product/08_gtm_pricing.md` §2).
Written 2026-09-30. Repositories checked with `gh api` that day: all four are active (pushed 09-29 or 09-30) with issues enabled; zodl-inc's Swift SDK is
now zodl-inc/zodl-swift-wallet-sdk. Before filing: search each tracker for "source of funds", "dossier", "EDD" and "proof of funds" to avoid a duplicate;
link Zodl's own "Export Tax File" issues (zodl-android #1776, zodl-ios #1465, per docs/PRIOR_ART.md) as the precedent.
The zingo-cli path below was read from zingolib's source (`zingo-cli/src/commands.rs`, `export_ufvk` prints {"ufvk", "birthday"}) and has NOT been run by us:
run it once on testnet before claiming it works, and record the run in docs/PROOF.md.
The API signatures are from `packages/verify/src/index.d.ts` and `crates/zeceipt-cli/src/main.rs` on 2026-09-30.
-->

# Wallet integration: "Export source-of-funds dossier"

Three issue drafts, one per wallet, and the command-line path that works today without any wallet change. The ask is the same in each: a button that builds a dossier locally from keys the wallet already has, and a helper for the control challenge. Nothing leaves the device unless the user sends the file.

## The shared text

> **Export source-of-funds dossier**
>
> **Problem.** Exchanges, swap services and OTC desks ask shielded holders where their funds came from, and whether the wallet is theirs: Kraken's EDD email (forum /t/55347), Binance's refusal of shielded deposits (/t/47667), and a $589k hold at NEAR Intents for more than 67 days where the holder, a Zodl user, answered with screenshots and hashes (/t/57497). Today the choices are to deshield, or to hand over the viewing key, which opens every past and future payment.
>
> **Proposal.** A "Source of funds" screen that exports a dossier ([`zeceipt-dossier-v1`](https://github.com/beautifulrem/zeceipt/blob/master/spec/dossier-v1.md)): note openings for the funds in question, sender receipts (ZIP 311 output disclosures) for payments made from them, and the account's nullifier key `nk`, which links each note to the transaction that spent it. The reviewer checks every claim against the chain in a browser (https://beautifulremi.dpdns.org/zeceipt/case/#sample) or on their own server. It never contains a viewing key.
>
> **Flow.**
> 1. The user picks the funds to explain (a date or height range, or the transactions around a deposit). The wallet already knows the transaction ids.
> 2. Optional, when the reviewer sent a nonce: "Answer a challenge" pre-fills a send to the user's own address with the nonce as the memo. The transaction must spend the notes being explained; sending the full balance to self spends them all.
> 3. The wallet builds the dossier locally with the UFVK it already holds, and shows what it discloses before saving: every note in the listed transactions (value, address, memo), the payments made from them, and `nk`.
> 4. Share sheet: `dossier.json`.
> 5. After the case: offer to move the remaining funds to a new account, since `nk` lets the reviewer see when the disclosed notes are later spent (spec §8.5).
>
> **Limits the screen must state.** It does not prove who the counterparties are, anything before the first disclosed origin, or that funds are unspent now; disclosure is permanent. Sapling notes cannot be a dossier's subject (their nullifier needs the note position); move them to Ironwood first. From NU7's activation (testnet 2026-10-06, mainnet 2026-11-05), new transactions need a zeceipt build with NU7 support.
>
> **Implementation.** Open source, Apache-2.0: Rust crates (`zeceipt-core`: `dossier::build`, `dossier::check_dossier`, `WalletScanner`) and `@zeceipt/verify` (WebAssembly). We would do the integration work and send the pull request, if you agree on the UX first.

## Draft 1: zodl-inc/zodl-ios

Title: **Export source-of-funds dossier (EDD / held-deposit evidence without a viewing key)**

Body: the shared text, then:

> **Where it would live.** Next to "Export Tax File" (#1465), which already turns the wallet's history into a file for a third party. The Rust side would sit behind the Swift SDK's FFI (zodl-inc/zodl-swift-wallet-sdk), as a function taking the account's UFVK, the raw transactions (the SDK can fetch them by txid), an optional `(control txid, nonce)` and a subject string, and returning the dossier JSON:
>
> ```rust
> use zeceipt_core::dossier::{build, BuildInput};
> let keys = zeceipt_core::OutgoingKeys::from_ufvk(network, &ufvk)?;
> let d = build(BuildInput { keys: &keys, txs, control, subject, created })?;   // txs: raw bytes, oldest first; control: Option<(raw tx, nonce)>
> let json = d.to_json()?;
> ```
>
> Questions for the team: is a new FFI function acceptable, or would you rather run the WebAssembly build in a web view? Should the challenge send reuse the existing send flow with a pre-filled memo?

## Draft 2: zodl-inc/zodl-android

Title: **Export source-of-funds dossier (EDD / held-deposit evidence without a viewing key)**

Body: the shared text, then the same "Where it would live" as Draft 1, pointing to "Export Tax File" (#1776) and the Android SDK's Rust backend (zodl-inc/zodl-android-wallet-sdk, whose own tracker has issues disabled, so the discussion stays here).

## Draft 3: zingolabs/zingolib (and zingo-mobile)

Title: **`export_dossier`: a source-of-funds dossier for EDD, without handing over the UFVK**

Body: the shared text, then:

> **Where it would live.** zingolib is Rust, so the crate call is direct. A `zingo-cli` command, `export_dossier <from_height> [--control <txid> --nonce <nonce>]`, would scan with the wallet's own keys, fetch the transactions it already knows, and print the dossier; zingo-mobile could expose the same through `zingo-ffi`. Until then, the path below works with zingo-cli as it is.
>
> ```rust
> let keys = zeceipt_core::OutgoingKeys::from_ufvk(network, &ufvk_string)?;
> let dossier = zeceipt_core::dossier::build(zeceipt_core::dossier::BuildInput {
>     keys: &keys, txs /* raw bytes, oldest first */, control /* Option<(Vec<u8>, String)> */,
>     subject: None, created: None,
> })?;
> ```

## The path that works today, with no wallet change

For any wallet that can export a UFVK. With zingo-cli, whose `export_ufvk` prints `{"ufvk": …, "birthday": …}` (read from its source; not yet run by us):

```bash
# 1. In zingo-cli: export_ufvk  → save the "ufvk" value to my.ufvk (a file only you can read), note the "birthday"
# 2. Optional: answer the reviewer's nonce from the wallet itself (zingo-cli's send, to your own address, memo = the nonce)
# 3. Build locally; the UFVK stays on this machine:
zeceipt dossier build --ufvk-file my.ufvk --scan-from <birthday> \
    --control-txid <the challenge txid> --nonce <the reviewer's nonce> > dossier.json
# add --testnet for a testnet wallet
```

In a browser, the same with no install: the build page (https://beautifulremi.dpdns.org/zeceipt/build/) takes the UFVK, finds the transactions by scanning compact blocks in the page, and never sends the key. From JavaScript:

```js
import { initVerifier, scanWallet, buildDossier } from "@zeceipt/verify";
await initVerifier();
const found = await scanWallet({ ufvk, network: "main", from: birthday });
const dossier = await buildDossier({
  ufvk, network: "main",
  txids: found.map((t) => t.txid).filter((t) => t !== challengeTxid),   // oldest first; the challenge goes in `control`
  control: { txid: challengeTxid, nonce },         // or null
});
```

A viewing key is still sensitive: it opens every payment of the account. Paste it only into the page or the CLI on your own machine, and delete `my.ufvk` afterwards.
