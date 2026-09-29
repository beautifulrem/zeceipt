// Derived batch status (`docs/product/05_data_model_api.md`): one state and
// the next action per batch, computed from facts that each have one owner — the submission record, the
// chain status, the receipts — and never stored. Fail closed: only a mined transaction with enough
// confirmations counts as confirmed; an unknown outcome is never shown as progress.

import type { IdempotencyStore, SubmissionRecord } from "../execution/idempotency.ts";
import type { PayoutBackend, TxStatus, UnknownCause } from "../execution/types.ts";
import type { ConsoleDb } from "../../db/client.ts";
import type { Keyring } from "../crypto/seal.ts";
import { validApproval } from "./approvals.ts";
import { batchNonce, getBatch } from "./batches.ts";
import { currentLock } from "./rates.ts";
import { countReceipts } from "./receipts.ts";

export type BatchState =
  | "draft"
  // Slice I3: a valid approval of the batch as it is now, nothing sent yet (REQ-CON-10's "approved").
  | "approved"
  | "submitting"
  | "retryable"
  | "needs_attention"
  | "pending"
  | "confirming"
  | "confirmed"
  | "receipts_partial"
  | "receipts_issued"
  | "expired"
  // Slice H5c: voided while nothing could have been sent; final (R82: Stripe's void, BTCPay's cancel).
  | "voided";

/**
 * What an operator (or a worker) can do next:
 * - `approve`: approve the batch as it is now, at its current lock (slice I3; a lock comes first);
 * - `submit`: call `submit` again with the same nonce (first time, retry, or reconciliation);
 * - `wait`: nothing to do yet;
 * - `issue_receipts`: run `autoIssue` + `recordReceipts`;
 * - `resend_expired`: a human decision (`resubmitExpired`), the transaction can never be mined;
 * - `record_expiry`: call `ensureExpiryBound` (a broadcast has no expiry bound, so it could never be reported expired);
 * - `investigate`: the records disagree in a way no automatic call resolves (see `detail.cause`);
 * - `none`: finished.
 */
export type NextAction = "approve" | "submit" | "wait" | "issue_receipts" | "resend_expired" | "record_expiry" | "investigate" | "none";

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
    voidedAt?: string;
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
  /** When the batch was voided (slice H5c): final, whatever its failed attempts say. */
  voidedAt?: string;
  /**
   * A valid approval of the batch as it is now (slice I3): read only while nothing may have been sent (no
   * submission, or `failed_retryable`), where it decides between `approve` and `submit`. Absent means not approved.
   */
  approved?: boolean;
}

/** Pure: the status table of design §3.3.1.3.4.2, row for row. */
export function deriveBatchStatus(f: BatchFacts): BatchStatus {
  // A void is allowed only while nothing may have been sent (trigger 0019), so it outranks a failed attempt.
  if (f.voidedAt !== undefined) return { state: "voided", next: "none", detail: { voidedAt: f.voidedAt } };
  const s = f.submission;
  // Every attempt that will pay needs a valid approval (slice I3), so without one the next step is to approve.
  if (!s) return f.approved ? { state: "approved", next: "submit", detail: { items: f.itemCount } } : { state: "draft", next: "approve", detail: { items: f.itemCount } };
  switch (s.state) {
    case "submitting": {
      const stale = f.now.getTime() - Date.parse(s.createdAt) >= f.inFlightMs;
      return stale ? { state: "needs_attention", next: "submit", detail: { stale: true } } : { state: "submitting", next: "wait", detail: {} };
    }
    case "failed_retryable":
      // A re-lock after the refusal invalidates the approval: approve the batch at the new lock, then retry.
      return { state: "retryable", next: f.approved ? "submit" : "approve", detail: { error: s.error } };
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
    if (c.cause === "timeout") {
      // Without a recorded expiry bound, status can never say "expired": record it, then waiting resolves.
      if (s.expiresBy === undefined) return { state: "needs_attention", next: "record_expiry", detail: { txid, cause: c.cause } };
      return { state: "needs_attention", next: "wait", detail: { txid, cause: c.cause, expiresBy: s.expiresBy } };
    }
    // superseded / interrupted / not_ours / malformed_txid for the record's own txid: `submit` would only
    // replay the recorded txid, so no automatic call resolves it (e.g. a reader using another store or org).
    return { state: "needs_attention", next: "investigate", detail: { txid, cause: c.cause } };
  }
  const required = f.requiredConfirmations;
  if (c.confirmations < required) return { state: "confirming", next: "wait", detail: { txid, confirmations: c.confirmations, required } };
  // Confirmed: only now do receipts count (fail closed — receipts before confirmation never raise the state).
  if (f.receipts === 0) return { state: "confirmed", next: "issue_receipts", detail: { txid, confirmations: c.confirmations, required, receipts: 0, items: f.itemCount } };
  if (f.receipts < f.itemCount) return { state: "receipts_partial", next: "issue_receipts", detail: { txid, receipts: f.receipts, items: f.itemCount } };
  return { state: "receipts_issued", next: "none", detail: { txid, receipts: f.receipts, items: f.itemCount } };
}

/** The backend's own view: its chain status, the nonce store it writes, and its in-flight window. */
export interface StatusSource {
  status: PayoutBackend["status"];
  readonly store: IdempotencyStore;
  readonly inFlightMs: number;
}

/**
 * Gather the facts for one batch and derive its status. Uses the backend's own store and in-flight window,
 * so the reader cannot disagree with what `submit` will do. Asks the chain only when the batch was broadcast,
 * and re-reads the submission afterwards: if it changed meanwhile (another attempt started), the facts are
 * gathered once more so a stale snapshot is never combined with a newer chain status.
 */
export async function getBatchStatus(
  db: ConsoleDb,
  backend: StatusSource,
  orgId: string,
  batchId: string,
  opts: {
    requiredConfirmations: number;
    now?: () => Date;
    /** How approvals are checked (slice I3): the keyring they are MACed under and the backend that pays (`backendId`). */
    approval: { keyring: Keyring; backend: string };
  },
): Promise<BatchStatus | undefined> {
  const batch = await getBatch(db, orgId, batchId);
  if (!batch) return undefined;
  const nonce = batchNonce(batch);
  const same = (a?: SubmissionRecord, b?: SubmissionRecord) => a?.attempts === b?.attempts && a?.state === b?.state && a?.txid === b?.txid;
  let submission = await backend.store.get(nonce);
  let chain: TxStatus | undefined;
  for (let pass = 0; pass < 2; pass++) {
    chain = submission?.state === "broadcast" && submission.txid ? await backend.status(submission.txid) : undefined;
    const again = await backend.store.get(nonce);
    if (same(submission, again)) break;
    submission = again;
    chain = undefined;
  }
  if (submission?.state === "broadcast" && !chain) {
    // It changed twice while we read: report the newest record without a chain answer rather than guess.
    return { state: "submitting", next: "wait", detail: { txid: submission.txid } };
  }
  if (batch.voidedAt !== undefined) return deriveBatchStatus({ itemCount: batch.items.length, receipts: 0, requiredConfirmations: opts.requiredConfirmations, now: (opts.now ?? (() => new Date()))(), inFlightMs: backend.inFlightMs, voidedAt: batch.voidedAt });
  // Only where it decides the next step: nothing may have been sent yet.
  const approved = !submission || submission.state === "failed_retryable"
    ? (await validApproval(db, opts.approval.keyring, batch, await currentLock(db, orgId, batchId), opts.approval.backend)) !== undefined
    : undefined;
  return deriveBatchStatus({
    itemCount: batch.items.length,
    submission,
    approved,
    chain,
    receipts: await countReceipts(db, orgId, batchId),
    requiredConfirmations: opts.requiredConfirmations,
    now: (opts.now ?? (() => new Date()))(),
    inFlightMs: backend.inFlightMs,
  });
}
