// Derived batch status (design `.trellis/tasks/09-23-batch-status/design.md` §3.3.1.3.4.2): one state and
// the next action per batch, computed from facts that each have one owner — the submission record, the
// chain status, the receipts — and never stored. Fail closed: only a mined transaction with enough
// confirmations counts as confirmed; an unknown outcome is never shown as progress.

import type { IdempotencyStore, SubmissionRecord } from "../execution/idempotency.ts";
import type { PayoutBackend, TxStatus, UnknownCause } from "../execution/types.ts";
import type { ConsoleDb } from "../../db/client.ts";
import { batchNonce, getBatch } from "./batches.ts";
import { countReceipts } from "./receipts.ts";

export type BatchState =
  | "draft"
  | "submitting"
  | "retryable"
  | "needs_attention"
  | "pending"
  | "confirming"
  | "confirmed"
  | "receipts_partial"
  | "receipts_issued"
  | "expired";

/** What an operator (or a worker) can do next. `resend_expired` is a human decision (`resubmitExpired`). */
export type NextAction = "submit" | "wait" | "issue_receipts" | "resend_expired" | "none";

export interface BatchStatus {
  state: BatchState;
  next: NextAction;
  detail: {
    txid?: string;
    confirmations?: number;
    required?: number;
    receipts?: number;
    items?: number;
    error?: string;
    expiresBy?: number;
    cause?: UnknownCause;
    stale?: boolean;
  };
}

export interface BatchFacts {
  itemCount: number;
  submission?: SubmissionRecord;
  /** Chain status of `submission.txid`; required when the submission is `broadcast`. */
  chain?: TxStatus;
  receipts: number;
  requiredConfirmations: number;
  now: Date;
  /** Age after which a `submitting` record is stale (the backend's `inFlightMs`). */
  inFlightMs: number;
}

/** Pure: the status table of design §3.3.1.3.4.2, row for row. */
export function deriveBatchStatus(f: BatchFacts): BatchStatus {
  const s = f.submission;
  if (!s) return { state: "draft", next: "submit", detail: { items: f.itemCount } };
  switch (s.state) {
    case "submitting": {
      const stale = f.now.getTime() - Date.parse(s.createdAt) >= f.inFlightMs;
      return stale ? { state: "needs_attention", next: "submit", detail: { stale: true } } : { state: "submitting", next: "wait", detail: {} };
    }
    case "failed_retryable":
      return { state: "retryable", next: "submit", detail: { error: s.error } };
    case "unknown_outcome":
      return { state: "needs_attention", next: "submit", detail: { error: s.error, expiresBy: s.expiresBy } };
    case "broadcast":
      break;
  }
  const txid = s.txid;
  const c = f.chain;
  if (!c) throw new RangeError("a broadcast batch needs its chain status");
  if (c.state === "pending") return { state: "pending", next: "wait", detail: { txid } };
  if (c.state === "unknown") {
    if (c.cause === "expired") return { state: "expired", next: "resend_expired", detail: { txid, cause: c.cause, expiresBy: s.expiresBy } };
    if (c.cause === "timeout") return { state: "needs_attention", next: "wait", detail: { txid, cause: c.cause } };
    return { state: "needs_attention", next: "submit", detail: { txid, cause: c.cause } };
  }
  const required = f.requiredConfirmations;
  if (c.confirmations < required) return { state: "confirming", next: "wait", detail: { txid, confirmations: c.confirmations, required } };
  // Confirmed: only now do receipts count (fail closed — receipts before confirmation never raise the state).
  if (f.receipts === 0) return { state: "confirmed", next: "issue_receipts", detail: { txid, confirmations: c.confirmations, required, receipts: 0, items: f.itemCount } };
  if (f.receipts < f.itemCount) return { state: "receipts_partial", next: "issue_receipts", detail: { txid, receipts: f.receipts, items: f.itemCount } };
  return { state: "receipts_issued", next: "none", detail: { txid, receipts: f.receipts, items: f.itemCount } };
}

/** Gather the facts for one batch and derive its status. Asks the chain only when the batch was broadcast. */
export async function getBatchStatus(
  db: ConsoleDb,
  backend: Pick<PayoutBackend, "status">,
  store: IdempotencyStore,
  orgId: string,
  batchId: string,
  opts: { requiredConfirmations: number; inFlightMs?: number; now?: () => Date },
): Promise<BatchStatus | undefined> {
  const batch = await getBatch(db, orgId, batchId);
  if (!batch) return undefined;
  const submission = await store.get(batchNonce(batch));
  const chain = submission?.state === "broadcast" && submission.txid ? await backend.status(submission.txid) : undefined;
  return deriveBatchStatus({
    itemCount: batch.items.length,
    submission,
    chain,
    receipts: await countReceipts(db, orgId, batchId),
    requiredConfirmations: opts.requiredConfirmations,
    now: (opts.now ?? (() => new Date()))(),
    inFlightMs: opts.inFlightMs ?? 10 * 60_000,
  });
}
