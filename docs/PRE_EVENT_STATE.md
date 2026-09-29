# Pre-event state

Colosseum Crypto World's Fair runs 2026-09-14 to 2026-10-12 (PT). This repository was created on **2026-09-21 PT** (first commit `0667b7d`, authored 2026-09-22 00:07:49 +08:00 = 2026-09-21 09:07 PT) inside the hackathon window. No product code in this repository predates the event.

What existed before the event, and is not in this repo:
- A general study library of other hackathons' winning projects (Markdown notes, and local clones of those projects' public repositories for reading, built in June 2026), not specific to this product; none of that code is used here.
- No prototypes, no forks, no reused private code.

Made during the event, before this repository started, and not in this repo: the competition research and the product definition (a private Markdown knowledge base, written 2026-09-17 → 09-21), including the review of prior art summarised in `docs/PRIOR_ART.md` (reading other people's projects; none of their code is used).

Third-party code:
- published crates and npm packages, pinned by `Cargo.lock` and the npm lockfiles;
- the development workflow's local tooling (task notes, editor and agent settings) is kept out of the repository; `Cargo.lock` is most of the first commit. Fixtures (`fixtures/README.md`): three mainnet transactions fetched from Blockchair and lightwalletd during the event; the synthetic transaction (built from a mainnet template, not consensus-valid), its key and receipt, and the regtest transactions, key and receipt, all made during the event.
