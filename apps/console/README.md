# @zeceipt/console — execution and issuance library

The payout console's server-side core, written so the Next.js app (next task) calls it directly. No UI and no database yet: the idempotency store is a file store behind an interface the libSQL `batches` table will implement.

| Module | What it does |
|---|---|
| `lib/execution/types.ts` | `Batch`, `Preflight`, `Submitted`, `TxStatus`, the `PayoutBackend` contract (`docs/product/05_data_model_api.md` §2) and typed errors |
| `lib/execution/zkool-backend.ts` | `ZkoolBackend`: `preflight` (all problems at once), `submit` (idempotent per nonce), `status` (`pending` / `mined` / `unknown`), `reconcile`, `resubmitExpired` |
| `lib/execution/idempotency.ts` | `FileIdempotencyStore` (O_EXCL intent per nonce, atomic updates, txid index), `MemoryIdempotencyStore`, `batchDigest` |
| `lib/execution/zkool-client.ts` | GraphQL client; loopback-only by default; distinguishes a server refusal from a lost answer |
| `lib/execution/address.ts`, `money.ts`, `fee.ts` | ZIP 316 HRP + Bech32m checks, exact zat ↔ ZEC conversion, ZIP 317 fee estimate |
| `lib/issuance/auto-issue.ts` | `autoIssue`: confirmation gate, `zeceipt issue --only-to …`, per-item cross-check, verification |

Submission states:
- `submitting` → `broadcast` (txid recorded).
- `failed_retryable`: preflight failed or Zkool refused before building (`isPreBuildRefusal`), so nothing was sent. The next submit with the same nonce claims a new attempt exclusively.
- `unknown_outcome`: the answer was lost, or `pay` failed in a way that may follow a send. Zkool reports a failed gRPC send as a GraphQL error, so only known pre-build refusals count as "nothing sent". Such a nonce is never re-paid blindly. The next submit reconciles against the issuer's mined transactions by address + memo + value. If none matches and the account is *scanned* past the attempt's expiry bound (`expiresBy` = node tip after the attempt + 40; Zkool builds with expiry = tip + 40), that attempt can never be mined and the same nonce pays once more. The node tip alone is never trusted for this: Zkool's `synchronizeAccount` returns it without scanning when another sync holds its lock.

Record writes are compare-and-set per attempt (`IdempotencyStore.update`), so a slow writer cannot overwrite a newer attempt. A `broadcast` whose transaction expired unmined keeps replaying its txid from `submit`; re-sending it is the explicit `resubmitExpired(batch, nonce)`. The residual assumption is that Zkool does not start building after the request was abandoned and broadcast 40+ blocks later (RSK-21).

`autoIssue` matches every receipt to its own batch item (memo, value, payee address via the CLI's `matched_only_to`, not change, no output claimed twice). It verifies each receipt and only then writes the files; on any mismatch it throws and writes nothing.

Run (Node ≥ 24; TypeScript runs natively, `tsc` only type-checks):

```sh
npm ci
npx tsc --noEmit -p .
ZECEIPT_BIN=../../target/debug/zeceipt node --test test/*.test.ts          # unit tests (fake Zkool + real zeceipt on fixtures)
ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts                     # live regtest, see docs/REGTEST_RUNBOOK.md and PROOF §5c
```
