# Releasing

How a version of Zeceipt is released, written for the first one, v0.1.0. The tag is cut on 2026-10-09 after the security review rerun, and `@zeceipt/verify` is published on 2026-10-10 (`docs/product/11_plan.md` §8; WBS 4.1.1.4, 3.4.2.3, 4.1.1.3).

Steps marked 👤 are the maintainer's own, because they publish or use the maintainer's accounts or keys. The others can be run by anyone with the repository. Each step says what must be true before the next.

## 1. Before the tag

1. **Security review rerun** (WBS 3.4.2.3).
   - `scripts/security_review.sh` must exit 0: `cargo audit`, `npm audit` on both lockfiles, gitleaks over the history and the tree, and the source guards.
   - Record the run in `docs/SECURITY_REVIEW.md`.
2. **Every check CI runs**, from the repository root (`.github/workflows/ci.yml` is the reference):

   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --features zeceipt-core/synthetic -- -D warnings
   cargo test --workspace --features zeceipt-core/synthetic
   python3 scripts/check_source_guards.py && python3 scripts/check_product_docs.py
   python3 scripts/check_release.py && python3 scripts/test_check_release.py
   node packages/verify/test/verify.mjs && node packages/verify/test/pack.mjs
   (cd packages/verify && npm ci && ZECEIPT_BROWSER_E2E=1 node --test test/page.e2e.mjs)
   (cd apps/console && npm ci && npx tsc --noEmit -p . && npm run lint && ZECEIPT_BIN=../../target/debug/zeceipt node --test test/*.test.ts)
   (cd apps/console && ZECEIPT_APP_E2E=1 ZECEIPT_BROWSER_E2E=1 NO_PROXY='*' node --test test/app.e2e.test.ts)
   ```

   If the Rust crates changed since `packages/verify/pkg` was built, rebuild it first (README, "Building the WASM package"). `verify.mjs` and `check_release.py`, which reads the WASM's own `version()`, fail on a stale build.
3. **The repository's name.** `packages/verify/package.json`'s `repository.url` (`https://github.com/zeceipt/zeceipt`) and the package README's links must name the repository that will be pushed (WBS 2.4.3.4).
   - If the name differs, change both **before** the tag, so that the tag and the npm package say the same thing.
   - `pack.mjs` checks that every README link goes through `repository.url` and the `master` branch.
4. **The changelog.** In `CHANGELOG.md`:
   - rename `## [Unreleased]` to `## [0.1.0] - 2026-10-09`, the day the tag is cut;
   - delete its sentence "This section becomes `0.1.0` when the tag is cut";
   - add a new, empty `## [Unreleased]` above it.
   
   Commit this.
5. **The release check.** `python3 scripts/check_release.py --tag v0.1.0` must print "ready to tag v0.1.0". It requires:
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

`--verify-tag` stops if the tag isn't on the remote. The notes file, `docs/release/v0.1.0.md`, is written before the tag (slice R1b4).

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
