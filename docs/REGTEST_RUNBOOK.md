# Regtest runbook (consensus-valid Ironwood transactions without a faucet)

Moved into the repository on 2026-09-22 from `raw/tools/regtest/runbook.md`. Chain state, wallet, the throwaway mnemonic, the issuer signing key and captured outputs stay under `raw/tools/regtest/` (outside the repo); the capture scripts are `scripts/regtest/*.sh`.

Components (all built from source under raw/tools):
- zebrad v6.3.0 (`--features internal-miner`), config `zebrad.toml` (Regtest, all NUs incl. NU6.3 at height 1, internal miner to tm9vhD…, RPC 18232 without cookie auth, indexer gRPC 18230)
- zainod (Zaino), config `zainod.toml` (fetch backend from Zebra, gRPC 8137)
- zcash-devtool with `regtest_support`, wallet dir `regtest-wallet`, mnemonic = throwaway testnet wallet's (regtest-mnemonic.txt, mode 600). Deliberate: the same throwaway seed backs the regtest wallet and the testnet wallet of PROOF §4 (regtest and testnet share ZIP 32 coin type 1, so `fixtures/regtest-issuer-ufvk.txt` and the testnet UFVK in PROOF §4 are two encodings of one account's viewing key); both viewing keys are published on purpose, and neither wallet will ever hold value beyond faucet dust.

Steps
1. `zebrad -c zebrad.toml start` → wait for "successfully mined a new block"; coinbase matures after 100 blocks.
2. `zainod --config zainod.toml`
3. `zcash-devtool wallet -w regtest-wallet restore-mnemonic -n regtest -s localhost:8137 --birthday 1 -i regtest-wallet/identity.txt` (paste mnemonic), then `sync`, `balance`.
4. `shield` transparent coinbase into Ironwood; mine; `sync`.
5. `send --address <uregtest1… of a second account> --value 250000000 --memo "INV-R-001"`; mine; `sync`; note txid.
6. `zeceipt issue --endpoint http://127.0.0.1:8137 --ufvk <uviewregtest…> --txid <txid> --label … --key-file …` (regtest network handling: see notes)
7. `zeceipt verify --endpoint http://127.0.0.1:8137 …` and offline with `getrawtransaction` hex from zebrad RPC.

Notes: Zeceipt's `Network` enum has main/test only; regtest addresses use testnet-style prefixes for keys (`uviewregtest1`) which zcash_keys decodes with the Regtest network type. A `--network regtest` flag may need adding to the CLI (map to zcash_protocol::consensus::NetworkType::Regtest for key decoding and address encoding).

## Lessons (2026-09-22)
- `zcash-devtool wallet shield` proposes spending every transparent UTXO of the account, including immature coinbase (rejected by the validator: "spends are invalid before Height(created+100)"). With the internal miner paying our own address forever, some UTXO is always immature. Fix: after ~130 blocks, restart zebrad with `miner_address` set to an address **outside** the wallet (used the Zebra doc's testnet P2SH `t27eWDgjFYJGVXmzrXeVjnb5J3uXDM9xH9v`), keep mining, and shield once the last wallet coinbase is 100 blocks deep.
- Zaino over plain `http://127.0.0.1:8137` works with `zeceipt --regtest --endpoint http://127.0.0.1:8137` (TLS is only configured for https endpoints).
- Regtest key decoding needs `zcash_protocol` `local-consensus` (`LocalNetwork` with every upgrade at height 1); the devtool needs `--activation-heights` TOML with the same heights.

## Zkool GraphQL execution backend (2026-09-22)
- No Docker here → built from source: `raw/tools/zkool2` (shallow clone, commit 8785e5c), toolchain 1.95.0 (pinned by the repo), `cd rust && cargo build --release --bin zkool_graphql --no-default-features --features graphql` (≈ 11 min first build). Binary: `raw/tools/zkool2/target/release/zkool_graphql`.
- Local patch: `rust/src/api/coin.rs` regtest `nu6_3` activation 250 → 1 to match our zebrad (`git diff` in the clone). Zkool's regtest coin type is `--coin 2`.
- Run (from `raw/tools/zkool2/data`, db stays outside the repo): `zkool_graphql --coin 2 --lwd-url http://127.0.0.1:8137 --db-path …/data/regtest.db --port 9000 --no-mempool`. First start downloads Sapling params. Endpoint `POST /graphql`; no auth. Use `curl --noproxy '*'` / `NO_PROXY='*'` — the machine has a system proxy (Surge) that intercepts localhost otherwise.
- Restore the issuer with `useInternal: true` (pools 15); with `false` the balance shows 0 because devtool put the shielded coinbase and change at the internal scope.
- Tracer (restore path, as in run 2): `python3 zeceipt/scripts/zkool_regtest_tracer.py --mnemonic-file raw/tools/regtest-mnemonic.txt --graphql http://127.0.0.1:9000/graphql --recipients 3 --memo-prefix INV-R-00 --memo-start 2 --amounts 1.01,1.02,1.03` (`--use-internal` is the default and required on this chain; `--issuer-id <id>` only to reuse an already-restored account; the script bypasses proxies itself) → transcripts `zkool-tracer.txt` (run 1) / `zkool-tracer-run2.txt` (run 2); receipts via `zeceipt issue --regtest --ufvk $(cat issuer-ufvk.txt) --txid …` (issuer.key here, not in the repo); verification matrix `scripts/regtest/verify-batch2.sh` → `verify-batch2.out`.
- Pool bits: transparent 1, sapling 2, orchard 4, ironwood 8. Memo limit 512 bytes (client-side error). `pay` ≈ 8.5 s (proving), mined ≈ 19 s later by the internal miner.
- Change: Zkool encrypts the change output with the *external* OVK — receipts must exclude change by address ownership (done in zeceipt-core), not by OVK scope.
- Artifacts (2026-09-22): `zkool-tracer.txt` (run 1, `--issuer-id 5`, tx 48db254a…), `zkool-tracer-run2.txt` (run 2 with the committed script: restore path with `useInternal:true` → account 9, tx 541143995066e03b…, 3 memos asserted, exit 0), `zkool-recipient-notes.txt` (recipient `notes {memo}` views + the 512-byte memo probe tx 1d4c12e77197d79430dc6de8dbb9725d1ff1d9e482d217397c6c98afd8b7cdcb at height 648), `issue-batch2.out`, `verify-batch2.out` (produced by `scripts/regtest/issue-batch2.sh`, `verify-batch2.sh`, `recipient-notes.sh` — each reproduces its recorded output byte-for-byte).

## Console library end-to-end (2026-09-23, PROOF §5c)
- Build the binary the test calls: `cargo build --release -p zeceipt-cli` (or point `ZECEIPT_BIN` at another build).
- With zebrad (internal miner on), zainod and zkool_graphql running and the issuer restored in Zkool (account 9 here), from `apps/console`: `ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts`. Environment: `ZKOOL_URL`, `ENDPOINT`, `ZEBRA_RPC`, `ZKOOL_ISSUER` (default 9), `CONFIRMATIONS` (default 2), `ARTIFACT_DIR` (default `../raw/tools/regtest` relative to the repository root, i.e. outside it; it must hold `issuer.key`), `ZECEIPT_BIN` (default `target/release/zeceipt`).
- The test creates three recipient accounts in Zkool per run and sends 0.66 REG + fee from the issuer; it also sends one deliberately unaffordable `pay` that Zkool refuses (nothing is built).
- Outputs in `ARTIFACT_DIR`: `console-e2e-<stamp>.json` (transcript), `console-receipts-<stamp>/` (receipts), `console-nonces/` (the file idempotency store). Re-verify with `STAMP=<stamp> TXID=<txid> HEIGHT=<mined height> scripts/regtest/console-verify.sh > $ARTIFACT_DIR/console-verify-<stamp>.out`.

## Console app through HTTP (2026-09-23, PROOF §5d)
- Start the services: `zebrad -c zebrad.toml start`; `zainod start --config zainod.toml` (zainod 0.9 needs the `start` subcommand: plain `zainod --config …` fails with "unexpected argument"); and zkool_graphql as above.
- Note: zkool_graphql listens on `0.0.0.0:9000` (all interfaces, unauthenticated) and has no bind-address option. Run it only on a machine or network you trust, and stop it after the run.
- From `apps/console`: `ZECEIPT_REGTEST=1 NO_PROXY='*' node --test test/regtest.http.e2e.test.ts`. It builds the app, starts `next start` against the live stack, drives the pages' forms without JavaScript, verifies the receipts with the CLI, and writes `console-http-e2e-<stamp>.json` to `ARTIFACT_DIR`. Environment as for §5c, plus `ZECEIPT_BIN` (default `target/release/zeceipt`).

