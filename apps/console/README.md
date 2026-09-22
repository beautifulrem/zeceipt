# @zeceipt/console — execution and issuance library

The payout console's server-side core, written so the Next.js app (next task) calls it directly. No UI yet. Storage: one SQLite file (`db/`, better-sqlite3 + Drizzle) holding the execution nonce store, batches with their items, and receipts (the receipt envelope and URL sealed at rest).

| Module | What it does |
|---|---|
| `lib/execution/types.ts` | `Batch`, `Preflight`, `Submitted`, `TxStatus`, the `PayoutBackend` contract (`docs/product/05_data_model_api.md` §2) and typed errors |
| `lib/execution/zkool-backend.ts` | `ZkoolBackend`: `preflight` (all problems at once), `submit` (idempotent per nonce), `status` (`pending` / `mined` / `unknown`), `reconcile`, `resubmitExpired` |
| `lib/execution/idempotency.ts` | `IdempotencyStore` interface, `FileIdempotencyStore` (O_EXCL intent per nonce, fenced lock lease, txid index), `MemoryIdempotencyStore`, `batchDigest` |
| `lib/execution/sqlite-store.ts` | `SqliteIdempotencyStore`: the console's nonce store; every write is one synchronous `BEGIN IMMEDIATE` transaction; compare-and-set via conditional `UPDATE`; scoped by `orgId` |
| `db/schema.ts`, `db/client.ts`, `db/errors.ts`, `db/migrations/` | Drizzle schema (`submissions`, `submission_claims`, `submission_txids`, `batches`, `batch_items`) plus the freeze triggers (custom migration `0002`), `openDb` (better-sqlite3; WAL, FULL sync, foreign keys, busy timeout), `migrateDb`, busy → `StoreBusyError` |
| `lib/execution/validate.ts` | `batchProblems`: the one static rule set shared by preflight and the batch repository |
| `lib/crypto/seal.ts` | Sealing at rest: `Keyring` (wrap keys by id, per-org HKDF-SHA256), `seal`/`open` (AES-256-GCM, 96-bit random IV, the row identity as AAD), typed `SealError` |
| `lib/data/receipts.ts` | `recordReceipts` (the batch's own broadcast only, matched to items, idempotent, atomic), `listReceipts` (decrypted), `rewrapReceipts` (key rotation) |
| `lib/data/batches.ts` | Batch repository: `createBatch` (validated, atomic), `getBatch`, `listBatches` (exact totals), `toExecutionBatch`, `batchNonce` (`batch/<id>`), `newBatchId` (UUIDv7) |
| `lib/execution/zkool-client.ts` | GraphQL client; loopback-only by default; distinguishes a server refusal from a lost answer |
| `lib/execution/address.ts`, `money.ts`, `fee.ts` | ZIP 316 HRP + Bech32m checks, exact zat ↔ ZEC conversion, ZIP 317 fee estimate |
| `lib/issuance/auto-issue.ts` | `autoIssue`: confirmation gate, `zeceipt issue --only-to …`, per-item cross-check, verification |

Submission states:
- `submitting` → `broadcast` (txid recorded).
- `failed_retryable`: preflight failed or Zkool refused before building (`isPreBuildRefusal`), so nothing was sent. The next submit with the same nonce claims a new attempt exclusively.
- `unknown_outcome`: the answer was lost, or `pay` failed in a way that may follow a send. Zkool reports a failed gRPC send as a GraphQL error, so only known pre-build refusals count as "nothing sent". Such a nonce is never re-paid blindly. The next submit reconciles against the issuer's mined transactions by address + memo + value. If none matches and the account is *scanned* past the attempt's expiry bound (`expiresBy` = node tip after the attempt + 40 + a 10-block reorg margin; Zkool builds with expiry = tip + 40), that attempt can never be mined and the same nonce pays once more. The node tip alone is never trusted for this: Zkool's `synchronizeAccount` returns it without scanning when another sync holds its lock.

Record writes are compare-and-set per attempt (`IdempotencyStore.update`), so a slow writer cannot overwrite a newer attempt. Retry claims are recoverable: a claim whose holder never advanced the record within `inFlightMs` can be taken again, so a crash cannot wedge a nonce. Lock contention surfaces as `StoreBusyError`, and a store failure after a successful pay as `UnknownOutcomeError`. A `broadcast` whose transaction expired unmined keeps replaying its txid from `submit`; re-sending it is the explicit `resubmitExpired(batch, nonce)`. The residual assumptions (RSK-21): Zkool does not start building after the request was abandoned and broadcast 40+ blocks later; no reorg deeper than the margin lowers the tip right after a pay; and the file store's lock is a 30 s lease, so a process suspended inside a store write for longer than that (and longer than `inFlightMs` for a retry race) can lose exclusivity. Each write re-checks the lease. The SQLite store the console uses has no lease: every write is one `BEGIN IMMEDIATE` transaction.

`autoIssue` matches every receipt to its own batch item (memo, value, payee address via the CLI's `matched_only_to`, not change, no output claimed twice). It verifies each receipt and only then writes the files; on any mismatch it throws and writes nothing.

Run (Node ≥ 24; TypeScript runs natively, `tsc` only type-checks):

```sh
npm ci
npx tsc --noEmit -p .
ZECEIPT_BIN=../../target/debug/zeceipt node --test test/*.test.ts          # unit tests (fake Zkool + real zeceipt on fixtures)
ZECEIPT_REGTEST=1 node --test test/regtest.e2e.test.ts                     # live regtest, see docs/REGTEST_RUNBOOK.md and PROOF §5c
```
