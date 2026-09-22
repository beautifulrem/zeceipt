// Execution-backend contract for the payout console (docs/product/05_data_model_api.md §2).
// Money is integer zatoshi (bigint) everywhere inside the console; decimal strings only at the Zkool boundary.

export type Network = "main" | "test" | "regtest";

export interface BatchItem {
  /** Stable id of the payable this output pays (REQ-CON-3). */
  payableId: string;
  /** Recipient unified address for the batch's network. */
  address: string;
  /** Amount in zatoshi, > 0. */
  zat: bigint;
  /** Memo text (the payable reference, unique per org), ≤ 512 UTF-8 bytes. */
  memo: string;
}

export interface Batch {
  id: string;
  network: Network;
  items: BatchItem[];
}

export type PreflightProblemCode =
  | "empty_batch"
  | "too_many_recipients"
  | "address_hrp"
  | "address_checksum"
  | "amount_nonpositive"
  | "memo_empty"
  | "memo_too_long"
  | "memo_duplicate"
  | "duplicate_payable"
  | "insufficient_funds";

export interface PreflightProblem {
  code: PreflightProblemCode;
  /** Index into `batch.items` when the problem is item-specific. */
  itemIndex?: number;
  detail: string;
}

export interface Preflight {
  ok: boolean;
  problems: PreflightProblem[];
  totalZat: bigint;
  feeEstimateZat: bigint;
  /** Spendable Ironwood balance reported by the backend (after a sync). */
  spendableZat: bigint;
  /** Chain height the balance was read at. */
  height: number;
}

export interface Submitted {
  txid: string;
  /** true when the nonce had already been submitted and no new payment was made. */
  replayed: boolean;
  /** How the txid was obtained on a replay. */
  via: "fresh" | "record" | "reconciled";
}

export type TxStatus =
  | { state: "pending"; broadcastAt: string }
  | { state: "mined"; height: number; confirmations: number; tip: number }
  | { state: "unknown"; reason: string };

export interface StatusOptions {
  /** Treat a broadcast tx as `pending` for this long before calling it `unknown`. Default 30 min. */
  pendingTimeoutMs?: number;
}

export interface PayoutBackend {
  readonly name: "zkool-graphql" | "zallet-rpc" | "zip321-manual";
  preflight(batch: Batch): Promise<Preflight>;
  submit(batch: Batch, nonce: string): Promise<Submitted>;
  status(txid: string, opts?: StatusOptions): Promise<TxStatus>;
}

// ---- errors (all carry a stable `code` for the console's state machine) ----

export class ExecutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** The nonce was already used for a different batch. Never retried. */
export class NonceConflictError extends ExecutionError {
  constructor(nonce: string) {
    super("nonce_conflict", `nonce ${nonce} was already used for a different batch`);
  }
}

/** Another submit for this nonce started recently and has not finished. */
export class SubmissionInFlightError extends ExecutionError {
  constructor(nonce: string, sinceMs: number) {
    super("in_flight", `a submit for nonce ${nonce} started ${Math.round(sinceMs / 1000)} s ago and has not finished`);
  }
}

/**
 * We cannot tell yet whether the payment was broadcast. Never re-paid blindly: a later `submit` with the
 * same nonce reconciles against mined transactions, and pays again only once the earlier attempt's
 * transaction can no longer be mined (chain tip past its expiry bound, `SubmissionRecord.expiresBy`).
 */
export class UnknownOutcomeError extends ExecutionError {
  constructor(nonce: string, detail: string) {
    super("unknown_outcome", `outcome of nonce ${nonce} is unknown: ${detail}`);
  }
}

/** Preflight found problems; nothing was sent. */
export class PreflightFailedError extends ExecutionError {
  readonly problems: PreflightProblem[];
  constructor(problems: PreflightProblem[]) {
    super("preflight_failed", `preflight failed: ${problems.map((p) => p.code).join(", ")}`);
    this.problems = problems;
  }
}

/**
 * The backend refused the payment before building a transaction (a known pre-build refusal such as
 * insufficient funds, see `isPreBuildRefusal`); nothing was sent, so retrying with the same nonce is safe.
 */
export class PaymentRejectedError extends ExecutionError {
  constructor(detail: string) {
    super("payment_rejected", `backend rejected the payment: ${detail}`);
  }
}
