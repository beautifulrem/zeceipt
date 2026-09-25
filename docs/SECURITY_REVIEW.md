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
| Secrets, git history (234 commits) | gitleaks 8.30.1, default rules | 3 `generic-api-key` hits | **False positives.** A test's HKDF call over a dummy key and a fixed salt (`apps/console/test/seal.test.ts`), and the doc checker's tuple of product file names (`scripts/check_product_docs.py`, twice). The historic findings are in `.gitleaksignore` by fingerprint (commit-bound, so stable); the current lines carry `gitleaks:allow` (the checker's tuple became one `POLICY_DOCS` constant). |
| Secrets, working tree (untracked files included) | gitleaks 8.30.1 (`.gitleaks.toml`: the default rules, with `node_modules/`, `target/` and `.next/` left out; none of them is tracked. Round 1 also left out `packages/verify/pkg/`, which **is** committed, so a secret there went unseen by both scans; review J1 round 1 found it, and it is scanned since, clean) | Same false positives, now allowed | As above. |
| Exclusions cover only untracked paths | `scripts/security_review.sh` `gitleaks-exclusions-untracked` (every `.gitleaks.toml` allowlist path matched against `git ls-files`) | passed | Added in round 2, after the reviewer found a committed directory excluded. |
| Key material in code, secrets in logs | `scripts/check_source_guards.py` (NFR-1, NFR-6) | passed | — |

**Negative controls** (each made the runner exit 1, and was then restored):
- an untracked file holding a dummy AWS-style access key id, reported by `gitleaks-tree`;
- the cargo ignore removed, reported by `cargo-audit` on the warning;
- the console's pre-override `package.json` and lockfile, reported by `npm-audit:apps/console`;
- (round 2) the same dummy key in an untracked file under the committed `packages/verify/pkg/`, reported by `gitleaks-tree`. In round 1 it went unseen, which is the reviewer's control;
- (round 2) `packages/verify/pkg/` put back into `.gitleaks.toml`'s allowlist, reported by the new `gitleaks-exclusions-untracked` check: an exclusion may cover only paths with no tracked file.

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
| The hot wallet pays only for the console | Zkool started with `--jwt-public-key-file` refuses any request without a token; the console holds a token for its own account only (write, expiry), checked at startup, in a 0600 file, never printed (slice S3, RSK-25, `test/zkool-token.test.ts`; the route tests and the app e2e run against a fake that requires tokens); live: PROOF §5e |
| Payment integrity | One nonce per batch (REQ-CON-7); the rate guard (REQ-CON-21); the approval HMAC over the lines, lock and paying account, required before every attempt (REQ-CON-5, slice I3) |
| Audit trail holds no secret | `audit_log` details are chosen non-secret columns, checked against real receipts and approvals (slice I4) |
| Dependencies pinned | `Cargo.lock`, and `package-lock.json` in each package; CI installs with `npm ci` |

## Not done (recorded)
- **CI integration.** The repository has no remote yet, so a CI step cannot be verified here; add the runner to CI when it is pushed.
- **`cargo deny`** (licences, bans, sources) and SAST (e.g. semgrep): alternatives not adopted for the hackathon.
- **The pre-submission rerun** (10-08 → 10-09) closes WBS 3.4.2.3; its result is added here as a second dated section.
