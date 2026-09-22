# @zeceipt/console — execution and issuance library

The payout console's server-side core, written so the Next.js app (next task) calls it directly. No UI and no database yet: the idempotency store is a file store behind an interface the libSQL `batches` table will implement.

| Module | What it does |
|---|---|
| `lib/execution/types.ts` | `Batch`, `Preflight`, `Submitted`, `TxStatus`, the `PayoutBackend` contract (`docs/product/05_data_model_api.md` §2) and typed errors |
| `lib/execution/zkool-backend.ts` | `ZkoolBackend`: `preflight` (all problems at once), `submit` (idempotent per nonce), `status` (`pending` / `mined` / `unknown`), `reconcile` |
| `lib/execution/idempotency.ts` | `FileIdempotencyStore` (O_EXCL intent per nonce, atomic updates, txid index), `MemoryIdempotencyStore`, `batchDigest` |
| `lib/execution/zkool-client.ts` | GraphQL client; loopback-only by default; distinguishes a server refusal from a lost answer |
| `lib/execution/address.ts`, `money.ts`, `fee.ts` | ZIP 316 HRP + Bech32m checks, exact zat ↔ ZEC conversion, ZIP 317 fee estimate |
| `lib/issuance/auto-issue.ts` | `autoIssue`: confirmation gate, `zeceipt issue --only-to …`, per-item cross-check, verification |

Submission states: `submitting` → `broadcast` (txid recorded) · `failed_retryable` (the backend refused; nothing sent; the next submit with the same nonce claims a new attempt exclusively) · `unknown_outcome` (the answer was lost; never re-paid automatically; resolved by reconciliation against the issuer's mined transactions by memo + value, or by a human).

Run (Node ≥ 24; TypeScript runs natively, `tsc` only type-checks):

```sh
npm ci
npx tsc --noEmit -p .
ZECEIPT_BIN=../../target/debug/zeceipt node --test test/*.test.ts          # unit tests (fake Zkool + real zeceipt on fixtures)
ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts                     # live regtest, see docs/REGTEST_RUNBOOK.md and PROOF §5c
```
