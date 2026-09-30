# Pre-event state

Colosseum Crypto World's Fair runs 2026-09-14 to 2026-10-12 (PT). This repository was created on **2026-09-21 PT** (first commit `683ea02`, authored 2026-09-22 00:07:49 +08:00 = 2026-09-21 09:07 PT) inside the hackathon window. No product code in this repository predates the event.

What existed before the event, and is not in this repo:
- A general study library of other hackathons' winning projects (Markdown notes, and local clones of those projects' public repositories for reading, built in June 2026), not specific to this product; none of that code is used here.
- No prototypes, no forks, no reused private code.

Made during the event, before this repository started, and not in this repo: the competition research and the product definition (a private Markdown knowledge base, written 2026-09-17 → 09-21), including the review of prior art summarised in `docs/PRIOR_ART.md` (reading other people's projects; none of their code is used).

**How it was built.** One developer directed the work with AI coding assistants, which wrote code, reviewed it and ran searches; every change went through the tests and checks in this repository, and all cryptography is the upstream Zcash crates'. Before the repository went public on 2026-09-29, its history was rewritten three times. The rewrites gave every commit the maintainer's GitHub noreply identity, removed the local workflow-tool directories (task notes, editor and agent settings) and a local username and paths from old files, and reworded three commit messages that named those tools. Commit dates, authorship dates and code were not changed ([`SECURITY_REVIEW.md`](SECURITY_REVIEW.md), publication check).

Third-party code:
- published crates and npm packages, pinned by `Cargo.lock` and the npm lockfiles;
- data files copied unchanged, each attributed in `NOTICE`: test vectors from `zcash/zcash-test-vectors` (MIT OR Apache-2.0; `spec/test-vectors/orchard_note_encryption.json`, and the F4Jumble and unified-address vectors in `apps/console/test/fixtures/`), zecpay's sample payroll CSV (MIT; `apps/console/test/fixtures/zecpay-sample-payroll.csv`), and, for the interfaces, the Geist fonts (SIL OFL; `packages/verify/r/fonts/`, and the `geist` npm package in the console) and Lucide icons (ISC; `packages/verify/r/icons/`, and `lucide-react` in the console);
- the development workflow's local tooling (task notes, editor and agent settings) is kept out of the repository; `Cargo.lock` is most of the first commit. Fixtures (`fixtures/README.md`): six mainnet transactions, three fetched from Blockchair and lightwalletd on 2026-09-21 and three over gRPC-web from `zjs.zec.rocks/mainnet` on 2026-09-28; two synthetic transactions (built from a mainnet template, not consensus-valid; one carries a note value above MAX_MONEY), the first one's viewing key, and a receipt for each, and the regtest transactions, key and receipt, all made during the event.
