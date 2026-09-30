# Releasing

How a version of Zeceipt is released, written for the first one, v0.1.0. The tag is cut on 2026-10-02 → 10-03, and `@zeceipt/verify` is published on 2026-10-03 (moved earlier on 2026-09-30, PM round 1 D04, so both are visible during judging; the 10-08 → 10-09 security rerun then checks the final submission, and fixes after the tag ship as 0.1.x) (`docs/product/11_plan.md` §8; WBS 4.1.1.4, 3.4.2.3, 4.1.1.3).

Steps marked 👤 are the maintainer's own, because they publish or use the maintainer's accounts or keys. The others can be run by anyone with the repository. Each step says what must be true before the next.

## 1. Before the tag

First, check crates.io for a `zcash_protocol` release that knows NU7's consensus branch `0x77190AD9` (RSK-14): its `consensus.rs` maps `0x7719_0ad9` to `BranchId::Nu7` in `TryFrom<u32>` with no `cfg`. If one exists, do slice U1c before anything below, so v0.1.0 supports NU7:

- bump the Zcash crates, and apply the API changes recorded in `docs/releasing/nu7-spike.diff` (the released API may differ from main's);
- turn the two NU7-refusal tests in `crates/zeceipt-core/tests/branch.rs` into success cases;
- decide how the console's address validator treats revision-2 `zu`/`tu` addresses (on librustzcash main, `shielded_receivers`, which `--only-to` uses, accepts them, while `apps/console/lib/execution/address.ts` expects revision-0 prefixes);
- rebuild the WASM (`scripts/build_wasm.sh`) and update the README's sha256;
- remove the NU7 limitation from the release notes and the changelog, and update RSK-14 and THREAT_MODEL's residual.

If none exists, v0.1.0 ships refusing NU7 transactions by name (its release notes say so); it is not built on unreleased git dependencies (R122).

Then, in this order. The last step needs a clean tree, so every earlier step that changes a file ends with a commit.

1. **The repository's name** (WBS 2.4.3.4), first, because later checks read it.
   - `packages/verify/package.json`'s `repository.url` (`https://github.com/beautifulrem/zeceipt`, set 2026-09-29) and the package README's links must name the repository that will be pushed.
   - If the name differs, change both and commit, so that the tag and the npm package say the same thing.
   - `pack.mjs`, in step 4, checks that every README link goes through `repository.url` and the `master` branch.
2. **The release notes.** Write `docs/release/v0.1.0.md` (slice R1b4) and commit it. The tag's message and the GitHub release both point to it.
3. **Security review rerun** (WBS 3.4.2.3).
   - `scripts/security_review.sh` must exit 0: `cargo audit`, `npm audit` on both lockfiles, gitleaks over the history and the tree, and the source guards.
   - Record the run in `docs/SECURITY_REVIEW.md`, and commit it.
4. **CI's checks**, from the repository root (`.github/workflows/ci.yml` is the reference):

   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --features zeceipt-core/synthetic -- -D warnings
   cargo test --workspace --features zeceipt-core/synthetic
   T=$(mktemp -d) Z=./target/debug/zeceipt   # the CLI smoke run, in a temporary directory
   $Z keygen --out "$T/k.key" >/dev/null
   $Z issue --raw-tx-file fixtures/synthetic-ironwood.hex --ovk "$(cat fixtures/synthetic-ovk.hex)" --label release --key-file "$T/k.key" --out-dir "$T/r" >/dev/null
   $Z verify "$T"/r/*.json --raw-tx-file fixtures/synthetic-ironwood.hex --require-signature
   $Z pack --title release "$T"/r/*.json > "$T/pack.json"
   mkdir -p "$T/raw" && cp fixtures/synthetic-ironwood.hex "$T/raw/$(python3 -c "import json,glob,sys;print(json.load(open(glob.glob(sys.argv[1]+'/r/*.json')[0]))['txid'])" "$T").hex"
   $Z verify-pack "$T/pack.json" --raw-tx-dir "$T/raw" --require-signature
   if $Z verify; then echo "no arguments must fail"; false; else test $? -eq 3; fi; rm -rf "$T"
   python3 scripts/check_source_guards.py && python3 scripts/check_product_docs.py
   python3 scripts/check_release.py && python3 scripts/test_check_release.py
   node packages/verify/test/verify.mjs && node packages/verify/test/pack.mjs
   (cd packages/verify && npm ci && ZECEIPT_BROWSER_E2E=1 node --test test/page.e2e.mjs)
   (cd apps/console && npm ci && npx tsc --noEmit -p . && npm run lint && ZECEIPT_BIN="$(cd ../.. && pwd)/target/debug/zeceipt" node --test test/*.test.ts)
   (cd apps/console && ZECEIPT_APP_E2E=1 ZECEIPT_BROWSER_E2E=1 NO_PROXY='*' node --test test/app.e2e.test.ts)
   ```

   Dry run on 2026-09-28 at 70c9150, in a fresh worktree (slice C0): every command above passed (65 Rust tests, the featureless `cargo check`, the CLI smoke run, the checkers, a byte-identical WASM, the pack check, 17 page e2e, 459 console tests and 26 console e2e), and the tree stayed clean. `npm ci` warned that eslint 9.39.5 "is no longer supported" (a dev dependency, with no audit finding): look at it in the security rerun.

   CI runs two more steps that are left out here on purpose, because each writes into the tree and step 6 needs it clean:
   - **`make_synthetic`** rewrites `fixtures/`.
   - **The `wasm` job's `wasm-pack build`** writes `packages/verify/pkg`.
   
   If the Rust crates changed since `pkg/` was built, rebuild it (README, "Building the WASM package"), run the checks again, and commit. `verify.mjs`, and `check_release.py` (which reads the WASM's own `version()`), fail on a stale build.
5. **The changelog.** In `CHANGELOG.md`:
   - rename `## [Unreleased]` to `## [0.1.0] - <the day the tag is cut>` (planned 2026-10-02 → 10-03);
   - delete its sentence "This section becomes `0.1.0` when the tag is cut";
   - add a new, empty `## [Unreleased]` above it.
   
   Commit this.
6. **The release check.** `python3 scripts/check_release.py --tag v0.1.0` must print "ready to tag v0.1.0". It requires:
   - one version in all nine sources;
   - the dated `[0.1.0]` section first;
   - `Unreleased` empty;
   - a clean tree;
   - no `v0.1.0` tag yet.

## 2. The tag

Annotated, because git's documentation says annotated tags are meant for releases (R116):

```bash
git tag -a v0.1.0 -m "Zeceipt v0.1.0" -m "Release notes: docs/release/v0.1.0.md; changes: CHANGELOG.md [0.1.0]."
git show --no-patch v0.1.0 && git describe v0.1.0
```

👤 To sign the tag, use `-s` in place of `-a`. It signs with the tagger's own key (GPG or SSH, per `gpg.format`), so signing is the maintainer's choice.

Keep the message short and point to the notes file. `git tag -F` strips lines that start with `#` by default (`--cleanup=strip`), which would delete a markdown file's headings (R117).

## 3. 👤 Push and the GitHub release

These need the repository on GitHub (WBS 4.1.1.1).

```bash
git push origin master
git push origin v0.1.0
gh release create v0.1.0 --verify-tag --title "Zeceipt v0.1.0" --notes-file docs/release/v0.1.0.md
```

`--verify-tag` stops if the tag isn't on the remote. The notes file was committed before the tag (§1, step 2).

Once the repository has its URL and the first CI run on GitHub is green, add the following in a docs-only commit after the tag:
- **The CI badge**, at the top of `README.md`:

  ```markdown
  [![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/ci.yml)
  ```
- **The changelog's version links**, at the end of `CHANGELOG.md`, replacing the line that says they wait for a URL:

  ```markdown
  [unreleased]: https://github.com/<owner>/<repo>/compare/v0.1.0...HEAD
  [0.1.0]: https://github.com/<owner>/<repo>/releases/tag/v0.1.0
  ```

## 4. 👤 The npm package (`@zeceipt/verify`)

The first version is published by hand. Trusted publishing is set up in an existing package's settings, so it can't publish a package's first version, and provenance comes only from CI (R115).

1. **An npm account with two-factor authentication.** Direct publishing requires 2FA, or a granular token that bypasses it.
2. **The scope.** On npmjs.com, create the organization `zeceipt`; its name is the scope. Choose the free "Unlimited public packages" plan (R117).
   - If `zeceipt` is taken, the package needs another scope. Renaming it changes `package.json`, the README and the docs, before the tag.
   - Today the registry answers 404 for `@zeceipt/verify`, so the name is free.
3. **From the tag, check first:**

   ```bash
   git checkout v0.1.0
   cd packages/verify
   node test/pack.mjs          # the tarball's ten files, public access, the README's Node example through the installed package
   npm publish --dry-run       # what would be uploaded, and as which version
   npm publish                 # public, from publishConfig; asks for the 2FA code
   ```

   A version number can be published only once, even after an unpublish (npm's unpublish policy, R117), so check the dry run's version and file list before the real publish.
4. **Afterwards:**
   - `npm view @zeceipt/verify version` shows `0.1.0`;
   - the package page shows the README, with its links resolving to the pushed repository (REQ-WEB-8);
   - `git checkout master`.

**Later versions** can be published by trusted publishing from a GitHub Actions workflow:
- add the workflow file, and the publisher in the package's settings on npmjs.com;
- it needs npm 11.5.1 or later and Node 22.14.0 or later;
- publishers set up after 2026-09-03 default to `npm stage publish`, which is approved after npm's malware scan.

This gives the package provenance. It isn't part of v0.1.0.

## 5. After the release

- Mark WBS 4.1.1.4 and 4.1.1.3 ✅ with the tag's commit and the npm version.
- Update REQ-WEB-8 in `docs/product/01_requirements.md` and the README's "Status", which today says npm publishing is pending.
- The next change goes under `## [Unreleased]`.

## 6. 👤 Before the submission: the live site answers

Added 2026-09-30 (appraisal round 1, D14). On 09-30 a reviewer opened the site at 13:29 UTC, just after a push, and got the old landing page and a 404 for `case/` and `build/`: `pages.yml` deploys only after `ci.yml` succeeds on `master` (about 6 minutes then), so the live site lags every push. A judge who opens the README's links in that window sees 404s.

1. **Freeze `master`** for the submission: the last push is a docs or code change you are done with, not a fix in flight.
2. **After the last push, wait for both workflows**, and stop if either fails:

   ```bash
   gh run watch --exit-status "$(gh run list --workflow ci.yml --branch master --limit 1 --json databaseId --jq '.[0].databaseId')"
   sleep 30   # pages.yml starts when ci.yml completes
   gh run watch --exit-status "$(gh run list --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

3. **Check the pages answer 200**, from outside the maintainer's cache:

   ```bash
   for p in "" case/ build/; do
     printf '%-8s ' "${p:-/}"; curl -s -o /dev/null -w '%{http_code}\n' "https://beautifulremi.dpdns.org/zeceipt/$p"
   done   # all three must print 200
   ```

   Then open `https://beautifulremi.dpdns.org/zeceipt/case/#sample` in a private window and wait for "All 12 claims verified" (about 7 s): a 200 with a stale page would pass the curl.
4. **Only then** submit, or post a link (the forum call, the videos' descriptions). If a check fails, fix it and repeat from step 2; do not submit while the site is behind the repository.

After NU7's activations (testnet 2026-10-06, mainnet 2026-11-05) repeat step 3 once: the samples' transactions predate NU7 and should keep verifying live (RSK-14b).
