# Security self-review

WBS 3.4.2.3; RSK-17. This review must pass before the v0.1.0 tag and `npm publish @zeceipt/verify`, both of which are irreversible (release order in `docs/product/09_submission_checklist.md`).

Run it with one command: `scripts/security_review.sh`. It needs `cargo-audit` (`cargo install cargo-audit --locked`), `gitleaks` (`brew install gitleaks`) and npm. It exits 1 on any finding or missing tool. Accepted findings live in the files the tools read, each with its reason:
- `.cargo/audit.toml`;
- `.gitleaks.toml`;
- `.gitleaksignore`;
- `gitleaks:allow` comments.

## First pass: 2026-09-25 (slice J1)

| Check | Tool, database | Result | Disposition |
|---|---|---|---|
| Rust dependencies (`Cargo.lock`, 304 crates) | cargo-audit 0.22.2; RustSec advisory database, 1,269 advisories, updated 2026-09-25 | 0 vulnerabilities; 1 warning: RUSTSEC-2023-0089, `atomic-polyfill` 1.0.3 unmaintained | **Accepted, never compiled.** It enters `Cargo.lock` only through reddsa 0.5.2's optional `frost` feature (frost-rerandomized → frost-core → postcard → heapless 0.7 → atomic-polyfill), which no workspace crate enables. `cargo tree --all-features --target all -e all` prints none of them. Ignored in `.cargo/audit.toml`; re-check when reddsa or the zcash crates move. |
| npm, `apps/console` (full tree) | npm audit; GitHub Advisory Database | Before: 4 moderate, all GHSA-67mh-4wv8-2f99 (esbuild ≤ 0.24.2: "enables any website to send any requests to the development server and read the response"), through drizzle-kit 0.31.11 → the deprecated `@esbuild-kit/esm-loader` → esbuild 0.18.20. The production tree (`--omit=dev`) had 0. | **Fixed.** `overrides` pins `@esbuild-kit/core-utils`'s esbuild to `^0.25.12`, deduped with drizzle-kit's own (the override targets the binary-bearing package, not its wrapper). Upstream: drizzle-orm issue #5145 is fixed only in the 1.0 beta, which changes the migrations folder format this repository's checkers rely on. After: `npm audit` 0; a fresh `npm ci` has no esbuild 0.18; `drizzle-kit generate` reports "No schema changes". |
| npm, `packages/verify` | npm audit | 0 | — |
| Secrets, git history (234 commits, counted before the 2026-09-29 history rewrite) | gitleaks 8.30.1, default rules | 3 `generic-api-key` hits | **False positives.** A test's HKDF call over a dummy key and a fixed salt (`apps/console/test/seal.test.ts`), and the doc checker's tuple of product file names (`scripts/check_product_docs.py`, twice). The historic findings are in `.gitleaksignore` by fingerprint (commit-bound, so stable); the current lines carry `gitleaks:allow` (the checker's tuple became one `POLICY_DOCS` constant). |
| Secrets, working tree (untracked files included) | gitleaks 8.30.1 (`.gitleaks.toml`: the default rules, with `node_modules/`, `target/` and `.next/` left out; none of them is tracked. Round 1 also left out `packages/verify/pkg/`, which **is** committed, so a secret there went unseen by both scans; review J1 round 1 found it, and it is scanned since, clean) | Same false positives, now allowed | As above. |
| Exclusions cover only untracked paths | `scripts/security_review.sh` `gitleaks-exclusions-untracked` (every `.gitleaks.toml` allowlist path matched against `git ls-files`) | passed | Added in round 2, after the reviewer found a committed directory excluded. |
| Key material in code, secrets in logs | `scripts/check_source_guards.py` (NFR-1, NFR-6) | passed | — |

**Negative controls** (each made the runner exit 1, and was then restored):
- an untracked file holding a dummy AWS-style access key id, reported by `gitleaks-tree`;
- the cargo ignore removed, reported by `cargo-audit` on the warning;
- the console's pre-override `package.json` and lockfile, reported by `npm-audit:apps/console`;
- (round 2) the same dummy key in an untracked file under the committed `packages/verify/pkg/`, reported by `gitleaks-tree`. In round 1 it went unseen, which is the reviewer's control;
- (round 2) `packages/verify/pkg/` put back into `.gitleaks.toml`'s allowlist, reported by the new `gitleaks-exclusions-untracked` check: an exclusion may cover only paths with no tracked file.

## Interim pass: 2026-09-27 (slice S6, a dry run at c91729c)

This run was made eleven days before the formal rerun (10-08 → 10-09, WBS 3.4.2.3), so a new advisory or leak would surface while there is time to act. It does not replace the rerun. `scripts/security_review.sh` exited 0:

| Check | Tool, database | Result |
|---|---|---|
| Rust dependencies (`Cargo.lock`, 304 crates) | cargo-audit 0.22.2; RustSec advisory database, 1,271 advisories (fetched at the run) | 0 vulnerabilities. The accepted RUSTSEC-2023-0089 warning is unchanged and still covered by `.cargo/audit.toml` |
| npm, `apps/console` | npm audit | 0 vulnerabilities |
| npm, `packages/verify` | npm audit | 0 vulnerabilities |
| Secrets, git history (417 commits, counted before the 2026-09-29 history rewrite) | gitleaks 8.30.1 | no leaks (about 7.65 MB scanned) |
| Secrets, working tree | gitleaks 8.30.1 | no leaks |
| Exclusions cover only untracked paths | `gitleaks-exclusions-untracked` | passed |
| Key material in code, secrets in logs | `scripts/check_source_guards.py` | passed |

Since the first pass closed (b7d9b08), `Cargo.lock` gained no crate (304 before and after), only six dependency edges from `zeceipt-cli` to crates already locked (`hyper`, `hyper-util`, `http-body-util`, `rustls`, `tokio-rustls`, `webpki-roots`), for the issuer-binding fetch (slice W2b). The two `package.json` files changed scripts, `publishConfig` and the homepage field, not dependencies; no `package-lock.json` changed. The committed WASM was rebuilt without local paths (slice X3a).

## Interim pass: 2026-09-28 (slice SR1, a second dry run at 880b97a)

`scripts/security_review.sh` exited 0 again, ten days before the formal rerun:

| Check | Result |
|---|---|
| Rust dependencies (`Cargo.lock`, 304 crates) | cargo-audit, RustSec database of 1,273 advisories: 0 vulnerabilities; the accepted RUSTSEC-2023-0089 warning is unchanged |
| npm, `apps/console` and `packages/verify` | 0 vulnerabilities each |
| Secrets, git history (472 commits, counted before the 2026-09-29 history rewrite) and the working tree | gitleaks: no leaks |
| Key material in code, secrets in logs | source guards passed, now with the spend-authority identifier rule (slice G1) |

**Changed since the first dry run.** One upstream advisory, and four findings from this repository's own reviews:

| Change | Why | Evidence |
|---|---|---|
| A v5/v6 transaction under a branch its version is not valid in (such as v6 under NU6.1) is refused as malformed (slice U2) | Zebra's GHSA-h5rr-8pqv-grp9 (high, fixed in Zebra 6.4.2): `zcash_primitives` parses such a transaction, and Zebra 6.4.0–6.4.1 aborted re-serializing it. zeceipt never re-serializes, so it did not crash, but it accepted bytes that are never valid. The local regtest zebrad is 6.3.0, which the advisory lists as unaffected `[R127]` | `crates/zeceipt-core/tests/branch.rs` (mined mainnet v5 and v6 fixtures; every mutant tried in review killed); the WASM at stage `tx` |
| Seeded mutation tests over every committed transaction, and over a signed receipt (as JSON and as a link), an audit pack and a well-known file (slice U3) | The advisory above was found by fuzzing; in the browser a panic traps the WASM | `crates/zeceipt-core/tests/mutation.rs`: no panic in 55,000 transactions (all eleven committed; 29,626 issued receipts verified) and 250,000 receipt-side inputs in the release run (rerun in slice C0 with the eleventh fixture); a smaller run in every `cargo test` |
| `verify-pack` counts each output once (slice U4) | Found in review U3: a receipt listed twice doubled the "lower bound" (Glasspane's rooms sum the same way) `[R130]` | `crates/zeceipt-cli/tests/cli.rs`: a repeat, and two batches with overlapping indices; mutants of the key killed |
| A recovered note value above MAX_MONEY is refused, in every pool, and the WASM never returns `null` (slices U5, U5b) | A crafted file-loaded output worth MAX_MONEY + 1 verified as valid; above 2^53 the WASM returned `null` `[R131]` | `crates/zeceipt-core/tests/offline_e2e.rs` (Ironwood and Sapling, each recovery site pinned); `packages/verify/test/verify.mjs` |
| The source guard matches spend-authority identifiers and names its one exemption; CI builds without the `synthetic` feature (slice G1) | Review U5b: the word list passed a renamed variable, and CI could not catch a featureless build break | `scripts/check_source_guards.py` (every probe caught: identifiers, a `#[path]` side door, the feature enabled any non-dev way); `.github/workflows/ci.yml` |

## Publication check: 2026-09-29 (slice P1, at 71f3004)

Before the repository was made public, its history was rewritten twice: every commit is authored under the maintainer's GitHub identity, the local workflow tooling is removed from every commit, local paths are removed from old text files, and the local username is replaced in old file versions (WASM builds committed before path remapping still carry anonymised `/Users/user_/.cargo/…` paths; the current WASM carries none). Commit ids cited in these docs were remapped to the new history. Commit counts in the sections above were counted before the rewrite. `scripts/security_review.sh` exited 0 on the rewritten history:

| Check | Result |
|---|---|
| Rust dependencies (`Cargo.lock`) | cargo-audit: 0 vulnerabilities; the accepted RUSTSEC-2023-0089 warning is unchanged |
| npm, `apps/console` and `packages/verify` | 0 vulnerabilities each |
| Secrets, git history (354 commits) and the working tree | gitleaks: no leaks; the three recorded false positives are re-keyed to their rewritten commits in `.gitleaksignore` |
| Key material in code, secrets in logs | source guards passed |

## Manual checklist

Each item is re-read at every run; the evidence is where it is proven.

| Item | Evidence |
|---|---|
| No spending key or seed in the app; no key material in workspace code | NFR-1 source guard (`scripts/check_source_guards.py`); custody modes in `docs/THREAT_MODEL.md` and `apps/console/README.md` |
| No secret in logs or output (wrap keys, OCKs, receipts, CLI output) | NFR-6 guard; `assertNoKey` over every server's output in the app e2e; the receipt worker logs batch ids and codes only (slice I2) |
| Receipt links never reach a server | The fragment form `/r#<payload>`; the Chrome e2e checks every request, header and storage area (`docs/PROOF.md` §2c) |
| OCKs and receipt links sealed at rest | AES-256-GCM with HKDF per-org keys and AAD (`lib/crypto/seal.ts`, slice B2); tamper tests |
| Requests only from this machine; no cross-site writes | The `start` and `dev` scripts bind 127.0.0.1 (slice S1; the app e2e starts through `npm start` and is refused on the machine's network address); the request guard (loopback Host, same-origin writes) on every page and API route (`proxy.ts`, `guarded()`), which stops browsers and DNS rebinding, not a peer choosing its own Host |
| The console cannot be framed (clickjacking) | Every response carries `Content-Security-Policy: frame-ancestors 'none'` (with `base-uri`, `form-action 'self'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy: no-referrer` (`next.config.ts`, slice S4); the app e2e checks pages, API answers, static files, a 404 and a refusal, and a hostile origin's iframe of a batch page is blocked in Chrome (negative control: without the headers it renders) `[R98]` |
| Pages run only their own scripts | `proxy.ts` gives each page response a fresh nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, on top of S4's directives. Rendering is dynamic everywhere (the root layout awaits `connection()`). The app e2e checks a fresh nonce on every script tag of four responses, the JavaScript draft form working with no violation, and injected markup's inline handler blocked (negative control: without the policy it runs) (slice S4b) `[R103]` |
| Pages load nothing from elsewhere | The page policy adds `default-src 'self'`, `style-src 'self' 'nonce-…'`, `img-src 'self' data:`, `font-src 'self'` and `connect-src 'self'` (slice S4c), and the console has its own 404 page (Next's built-in one styles itself inline). The app e2e walks eight pages with no violation, uses the draft form and a client-side navigation, and sees injected remote images and stylesheets refused as `csp`; negative control: without the directives no violation fires `[R104]` |
| The hot wallet pays only for the console | Zkool started with `--jwt-public-key-file` refuses any request without a token; the console holds a token for its own account only (write, expiry), checked at startup, in a 0600 file, never printed, its signature checked at boot against Zkool's public key, and refuses to pay through a Zkool that answers a request without it (slices S3, S3b and S3c, RSK-25, `test/zkool-token.test.ts`; the route tests and the app e2e run against a fake that requires tokens); live: PROOF §5e |
| Payment integrity | One nonce per batch (REQ-CON-7); the rate guard (REQ-CON-21); the approval HMAC over the lines, lock and paying account, required before every attempt (REQ-CON-5, slice I3); the wallet's mined history read before every `pay` call, so a database restored from a backup or edited back to "unpaid" adopts the transaction instead of paying again (slice S5, RSK-21, `[R99]`) |
| Audit trail holds no secret | `audit_log` details are chosen non-secret columns, checked against real receipts and approvals (slice I4) |
| Dependencies pinned | `Cargo.lock`, and `package-lock.json` in each package; CI installs with `npm ci` |
| Untrusted transaction and receipt bytes are mutation-tested against crashes | No crash found in seeded, sampled mutation (not coverage-guided) through parse, issue, verify, packs and the binding: 55,000 transactions and 250,000 receipt-side inputs in the release run (slices U3, C0); nothing re-serializes a parsed transaction; a transaction under a branch its version is not valid in is refused (slice U2). Residual: a malicious issuer's crafted plaintext is covered only for its value, since no mutation gets past the AEAD (`docs/THREAT_MODEL.md`) |
| Totals and values stay within what the chain allows | Each output counted once in an audit pack (slice U4); a recovered value above MAX_MONEY refused in every pool (slices U5, U5b) |

## In CI (2026-09-30)

The `security` job in `.github/workflows/ci.yml` runs `scripts/security_review.sh` on every push and weekly (Monday 06:17 UTC), so a new advisory against a locked dependency shows without a push: cargo-audit from `taiki-e/install-action`, gitleaks 8.30.1 checked against its release checksum, over the whole history (`fetch-depth: 0`). The same run passed locally on 2026-09-30 at `10dfeef` (every check PASS). Every action in the workflows is pinned to a commit.

## Not done (recorded)
- **`cargo deny`** (licences, bans, sources) and SAST (e.g. semgrep): alternatives not adopted for the hackathon.
- **The pre-submission rerun** (10-08 → 10-09) closes WBS 3.4.2.3; its result is added here as a second dated section.
