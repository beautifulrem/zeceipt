# Pre-event state

Colosseum Crypto World's Fair runs 2026-09-14 to 2026-10-12 (PT). This repository was created on **2026-09-21 PT** (first commit `252c76e`, authored 2026-09-22 00:07:49 +08:00 = 2026-09-21 09:07 PT) inside the hackathon window. No product code in this repository predates the event.

What existed before the event, and is not in this repo:
- Research notes and a product definition kept in a private knowledge base (Markdown), including a review of prior art listed in `docs/PRIOR_ART.md`.
- No prototypes, no forks, no reused private code.

Third-party code:
- published crates and npm packages, pinned by `Cargo.lock` and the npm lockfiles;
- the workflow tooling under `.trellis/` and `.claude/`: the Trellis workflow tool's scripts, specs and templates, and Claude Code's skills, hooks, agents and settings, installed with those tools (not product code). With `Cargo.lock`, they are most of the first commit: 94 of its 148 files are under these two directories. `.trellis/tasks/` and `.trellis/workspace/` hold this project's own task records and journal, written during the event. Fixture transactions under `fixtures/` are public mainnet data fetched from Blockchair / lightwalletd during the event.
