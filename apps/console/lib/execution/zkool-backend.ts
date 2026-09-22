// PayoutBackend for Zkool GraphQL (primary execution backend, REQ-CON-7; measured in PROOF §5b/§5c).

import { estimateIronwoodFeeZat } from "./fee.ts";
import { batchDigest, type Expect, type IdempotencyStore, type SubmissionRecord, type SubmissionState } from "./idempotency.ts";
import { decimalToZat } from "./money.ts";
import { batchProblems } from "./validate.ts";
import {
  ExecutionError,
  type Batch,
  type PayoutBackend,
  type Preflight,
  type PreflightProblem,
  type StatusOptions,
  type Submitted,
  type TxStatus,
  NonceConflictError,
  PaymentRejectedError,
  PreflightFailedError,
  SubmissionInFlightError,
  UnknownOutcomeError,
} from "./types.ts";
import { POOL, ZkoolClient, ZkoolGraphqlError, type ZkoolTx } from "./zkool-client.ts";

export interface ZkoolBackendOptions {
  client: ZkoolClient;
  /** Zkool account id of the issuing wallet (restored with `useInternal: true`, see PROOF §5b). */
  account: number;
  store: IdempotencyStore;
  /**
   * A `submitting` record younger than this is treated as in flight. Default 10 min. Must exceed the
   * longest an attempt can take on our side (preflight's two requests + pay + the expiry-bound request),
   * checked in the constructor.
   */
  inFlightMs?: number;
  /** Default pending timeout for `status`. Default 30 min. */
  pendingTimeoutMs?: number;
  maxRecipients?: number;
  /**
   * Blocks between the tip at build time and the transaction's expiry height. Zkool builds with
   * expiry = tip + 40 (e.g. tx 205c81ac… built at tip 2465 expires at 2505, PROOF §5c; four earlier runs agree); a transaction
   * can only be mined at or below its expiry height.
   */
  txExpiryDelta?: number;
  /**
   * Blocks added to every expiry bound. The bound uses the node tip observed after the attempt, which is
   * ≥ Zkool's build tip unless a reorg lowered the tip in between; the margin covers reorgs up to this
   * depth. Default 10 (≈ 12 min on mainnet before an uncertain nonce may pay again).
   */
  expiryMarginBlocks?: number;
  now?: () => Date;
}


/**
 * GraphQL errors Zkool's `pay` raises *before* it builds a transaction (zkool2 `pay/error.rs` and
 * `graphql/query.rs::prepare_tx`): nothing can have been broadcast, so the nonce may be retried at once.
 * Every other `pay` error — notably a gRPC failure inside `send_transaction`, which Zkool also reports
 * as a GraphQL error although the transaction may already have reached the node — is treated as an
 * unknown outcome. Unrecognised messages therefore fail safe.
 */
const PRE_BUILD_REFUSALS = [/^Not enough funds/, /^No feasible note selection found/, /^InvalidPoolMask/, /^No Signing Key/, /^No asset matches/, /^Ambiguous query/];

export function isPreBuildRefusal(e: ZkoolGraphqlError): boolean {
  return e.messages.length > 0 && e.messages.every((m) => PRE_BUILD_REFUSALS.some((re) => re.test(m)));
}

export class ZkoolBackend implements PayoutBackend {
  readonly name = "zkool-graphql" as const;
  private readonly client: ZkoolClient;
  private readonly account: number;
  private readonly store: IdempotencyStore;
  private readonly inFlightMs: number;
  private readonly pendingTimeoutMs: number;
  private readonly maxRecipients: number;
  private readonly txExpiryDelta: number;
  private readonly expiryMarginBlocks: number;
  private readonly now: () => Date;

  constructor(opts: ZkoolBackendOptions) {
    this.client = opts.client;
    this.account = opts.account;
    this.store = opts.store;
    this.inFlightMs = opts.inFlightMs ?? 10 * 60_000;
    this.pendingTimeoutMs = opts.pendingTimeoutMs ?? 30 * 60_000;
    this.maxRecipients = opts.maxRecipients ?? 50;
    this.txExpiryDelta = opts.txExpiryDelta ?? 40;
    this.expiryMarginBlocks = opts.expiryMarginBlocks ?? 10;
    this.now = opts.now ?? (() => new Date());
    const attemptMs = this.client.payTimeoutMs + 3 * this.client.timeoutMs;
    if (this.inFlightMs <= attemptMs) {
      throw new RangeError(`inFlightMs ${this.inFlightMs} must exceed the longest attempt ${attemptMs} ms (pay timeout + 3 × request timeout)`);
    }
  }

  /**
   * Sync the issuer, then return the node tip and the height the account is really scanned to. Every
   * "not mined up to h" conclusion uses `scanned`, never `tip` (see `ZkoolClient.sync`).
   */
  private async heights(): Promise<{ tip: number; scanned: number; spendableIronwood: string }> {
    const tip = await this.client.sync(this.account);
    const bal = await this.client.balance(this.account);
    return { tip, scanned: Math.min(tip, bal.height ?? 0), spendableIronwood: bal.ironwood };
  }

  /** Compare-and-set on the record; a lost race means another caller moved this nonce on. */
  private async save(next: SubmissionRecord, from: SubmissionRecord, states: SubmissionState[]): Promise<boolean> {
    const expect: Expect = { attempts: from.attempts, states };
    return this.store.update(next, expect);
  }

  /**
   * An outcome write whose failure must not mask the outcome error being thrown. If it fails the record
   * stays `submitting`; after `inFlightMs` a submit resolves it by reconciliation (never a blind re-pay).
   */
  private async saveOutcome(next: SubmissionRecord, from: SubmissionRecord, states: SubmissionState[]): Promise<void> {
    await this.save(next, from, states).catch(() => false);
  }

  /** Static checks that need no network; also used inside `preflight` (see `batchProblems`). */
  staticProblems(batch: Batch): PreflightProblem[] {
    return batchProblems(batch, { maxRecipients: this.maxRecipients });
  }

  async preflight(batch: Batch): Promise<Preflight> {
    const problems = this.staticProblems(batch);
    const totalZat = batch.items.reduce((s, it) => s + (it.zat > 0n ? it.zat : 0n), 0n);
    const feeEstimateZat = estimateIronwoodFeeZat(batch.items.length);
    // `height` is the scanned height the balance belongs to (≤ the node tip; the reconciliation lower bound).
    const { scanned: height, spendableIronwood } = await this.heights();
    const spendableZat = decimalToZat(spendableIronwood);
    if (totalZat + feeEstimateZat > spendableZat) {
      problems.push({
        code: "insufficient_funds",
        detail: `needs ${totalZat + feeEstimateZat} zat (payments ${totalZat} + fee estimate ${feeEstimateZat}), Ironwood spendable ${spendableZat}`,
      });
    }
    return { ok: problems.length === 0, problems, totalZat, feeEstimateZat, spendableZat, height };
  }

  async submit(batch: Batch, nonce: string): Promise<Submitted> {
    if (!nonce || nonce.length > 200) throw new RangeError("nonce must be 1..200 characters");
    const digest = batchDigest(batch);
    const intent: SubmissionRecord = {
      nonce,
      batchId: batch.id,
      batchDigest: digest,
      state: "submitting",
      createdAt: this.now().toISOString(),
      attempts: 1,
    };
    const created = await this.store.createIntent(intent);
    if (!created.created) {
      const existing = created.existing;
      if (existing.batchDigest !== digest) throw new NonceConflictError(nonce);
      switch (existing.state) {
        case "broadcast":
          return { txid: existing.txid!, replayed: true, via: "record" };
        case "submitting": {
          const age = this.now().getTime() - Date.parse(existing.createdAt);
          if (age < this.inFlightMs) throw new SubmissionInFlightError(nonce, age);
          return this.resolveUncertain(batch, existing, "a previous submit did not finish");
        }
        case "unknown_outcome":
          return this.resolveUncertain(batch, existing, existing.error ?? "transport failure during pay");
        case "failed_retryable":
          // Preflight failed or the backend refused before building: nothing was broadcast.
          return this.retry(batch, existing);
      }
    }
    return this.pay(batch, intent);
  }

  /**
   * Pay a broadcast batch again under the same nonce because its transaction expired unmined — the
   * console's explicit "re-send" action (a human decision; `submit` itself keeps replaying the recorded
   * txid). Refused unless the account is scanned past the recorded expiry bound and no transaction
   * paying the batch was mined.
   */
  async resubmitExpired(batch: Batch, nonce: string): Promise<Submitted> {
    const rec = await this.store.get(nonce);
    if (!rec) throw new ExecutionError("unknown_nonce", `nonce ${nonce} was never submitted`);
    if (rec.batchDigest !== batchDigest(batch)) throw new NonceConflictError(nonce);
    if (rec.state !== "broadcast") throw new ExecutionError("not_broadcast", `nonce ${nonce} is ${rec.state}; use submit`);
    const match = await this.reconcile(batch, rec);
    if (match.kind !== "none") throw new ExecutionError("not_expired", match.kind === "found" ? `a transaction paying this batch was mined: ${match.txid}` : match.detail);
    if (rec.expiresBy === undefined) {
      // The bound request failed after the broadcast: record node tip + delta now (≥ the tip at build time).
      const expiresBy = match.tip + this.txExpiryDelta + this.expiryMarginBlocks;
      await this.save({ ...rec, expiresBy }, rec, ["broadcast"]);
      throw new ExecutionError("not_expired", `transaction ${rec.txid} can still be mined (expiry bound now recorded as ${expiresBy}, scanned ${match.scanned})`);
    }
    if (!(match.scanned > rec.expiresBy)) {
      throw new ExecutionError("not_expired", `transaction ${rec.txid} can still be mined (expiry bound ${rec.expiresBy}, scanned ${match.scanned})`);
    }
    return this.retry(batch, rec);
  }

  /**
   * Start attempt `attempts + 1` under the same nonce. One caller claims each attempt number; a claim
   * whose holder never advanced the record within `inFlightMs` (it died or its write failed, so it never
   * paid) can be claimed again, so a nonce cannot be wedged. The compare-and-set write then decides.
   */
  private async retry(batch: Batch, rec: SubmissionRecord): Promise<Submitted> {
    const attempt = rec.attempts + 1;
    if (!(await this.store.claimAttempt(rec.nonce, attempt, this.inFlightMs))) throw new SubmissionInFlightError(rec.nonce, 0);
    const next: SubmissionRecord = { ...rec, state: "submitting", attempts: attempt, txid: undefined, broadcastAt: undefined, error: undefined, expiresBy: undefined, createdAt: this.now().toISOString() };
    // The claim is exclusive, so this can only fail if the record left `rec`'s attempt — nobody else pays.
    if (!(await this.save(next, rec, [rec.state]))) throw new SubmissionInFlightError(rec.nonce, 0);
    return this.pay(batch, next);
  }

  /**
   * Expiry bound for an attempt that has just returned (or failed): node tip now + expiry delta + margin. Zkool
   * builds with expiry = its tip at build time + 40, and it built before answering. Assumption: Zkool does
   * not start building after our request was abandoned for longer than it takes the chain to move past
   * this bound (a stall inside Zkool longer than the pay timeout); design.md 3.3.5.4.9.2.
   */
  private async expiryBound(): Promise<number | undefined> {
    try {
      return (await this.client.currentHeight()) + this.txExpiryDelta + this.expiryMarginBlocks;
    } catch {
      return undefined; // resolveUncertain derives a later (still valid) bound from the tip it syncs to
    }
  }

  /** We hold the intent for `rec`. Preflight, pay, record the outcome. */
  private async pay(batch: Batch, rec: SubmissionRecord): Promise<Submitted> {
    let pre: Preflight;
    try {
      pre = await this.preflight(batch);
    } catch (e) {
      // Nothing was sent yet; leave the nonce retryable.
      await this.save({ ...rec, state: "failed_retryable", error: `preflight error: ${(e as Error).message}` }, rec, ["submitting"]);
      throw e;
    }
    if (!pre.ok) {
      await this.save({ ...rec, state: "failed_retryable", error: `preflight: ${pre.problems.map((p) => p.code).join(",")}` }, rec, ["submitting"]);
      throw new PreflightFailedError(pre.problems);
    }
    const intentRec: SubmissionRecord = { ...rec, intentHeight: pre.height };
    // Losing this race means a resolver judged this attempt stale; do not pay behind its back.
    if (!(await this.save(intentRec, rec, ["submitting"]))) throw new SubmissionInFlightError(rec.nonce, 0);
    // Our own outcome writes may land after a resolver marked the attempt `unknown_outcome`; same attempt, so allowed.
    const mine: SubmissionState[] = ["submitting", "unknown_outcome"];
    let txid: string;
    try {
      txid = await this.client.pay(this.account, batch.items.map((i) => ({ address: i.address, zat: i.zat, memo: i.memo })), POOL.ironwood);
    } catch (e) {
      if (e instanceof ZkoolGraphqlError && isPreBuildRefusal(e)) {
        await this.saveOutcome({ ...intentRec, state: "failed_retryable", error: e.message }, intentRec, ["submitting"]);
        throw new PaymentRejectedError(e.message);
      }
      const why = e instanceof ZkoolGraphqlError ? `pay failed after it may have broadcast: ${e.message}` : (e as Error).message;
      await this.saveOutcome({ ...intentRec, state: "unknown_outcome", error: why, expiresBy: await this.expiryBound() }, intentRec, mine);
      throw new UnknownOutcomeError(rec.nonce, why);
    }
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      // Zkool returns the node's rejection text in place of a txid; treat it as unknown, it resolves at expiry.
      const why = `pay returned ${JSON.stringify(txid.slice(0, 200))} instead of a txid`;
      await this.saveOutcome({ ...intentRec, state: "unknown_outcome", error: why, expiresBy: await this.expiryBound() }, intentRec, mine);
      throw new UnknownOutcomeError(rec.nonce, why);
    }
    // Record the txid first (a crash right after `pay` must not lose it), then add the expiry bound.
    const done: SubmissionRecord = { ...intentRec, state: "broadcast", txid, broadcastAt: this.now().toISOString(), error: undefined };
    let recorded: boolean;
    try {
      recorded = await this.save(done, intentRec, mine);
    } catch (e) {
      // Paid, but the store failed: the caller must not see an untyped error (or success without a record).
      throw new UnknownOutcomeError(rec.nonce, `pay returned ${txid} but recording it failed (${(e as Error).message}); a submit with the same nonce reconciles it`);
    }
    if (!recorded) {
      // Only possible if a resolver already concluded this attempt could never be mined and started the next one.
      throw new UnknownOutcomeError(rec.nonce, `pay returned ${txid} after this attempt was superseded; check the chain before acting`);
    }
    const expiresBy = await this.expiryBound();
    if (expiresBy !== undefined) await this.saveOutcome({ ...done, expiresBy }, done, ["broadcast"]);
    return { txid, replayed: false, via: "fresh" };
  }

  /**
   * The payment may or may not have happened. Look for it on chain; never pay again blindly:
   * found → adopt its txid; not found and the account is *scanned* past the attempt's expiry bound → it can
   * never be mined, so pay again under the same nonce (a new attempt); otherwise → still unknown, say until when.
   */
  private async resolveUncertain(batch: Batch, rec: SubmissionRecord, why: string): Promise<Submitted> {
    const match = await this.reconcile(batch, rec);
    if (match.kind === "found") {
      const adopted: SubmissionRecord = { ...rec, state: "broadcast", txid: match.txid, broadcastAt: rec.broadcastAt ?? this.now().toISOString(), error: undefined };
      if (!(await this.save(adopted, rec, [rec.state]))) throw new SubmissionInFlightError(rec.nonce, 0);
      return { txid: match.txid, replayed: true, via: "reconciled" };
    }
    // No bound recorded (e.g. a crash mid-attempt): the node tip now is ≥ the tip when Zkool built, so
    // tip + delta is a valid (larger, i.e. safer) upper bound on that attempt's expiry height.
    const expiresBy = rec.expiresBy ?? match.tip + this.txExpiryDelta + this.expiryMarginBlocks;
    if (match.kind === "none" && match.scanned > expiresBy) return this.retry(batch, { ...rec, expiresBy });
    const detail = match.kind === "none" ? `${match.detail}; the attempt cannot be mined after height ${expiresBy}, a submit once the account is scanned past it pays again` : match.detail;
    const next: SubmissionRecord = { ...rec, state: "unknown_outcome", error: `${why}; ${detail}`, expiresBy };
    if (!(await this.save(next, rec, [rec.state]))) throw new SubmissionInFlightError(rec.nonce, 0);
    throw new UnknownOutcomeError(rec.nonce, `${why}; ${detail}`);
  }

  /**
   * Find a mined transaction of the issuing account (at or after the intent height) that pays every
   * batch item: an output with the same address, memo and value. Memos are unique payable references,
   * so one match is decisive; several matches are reported for a human to resolve. "none" means "none
   * mined up to `scanned`" (the account's scanned height, which can trail the node `tip`).
   */
  async reconcile(batch: Batch, rec: Pick<SubmissionRecord, "intentHeight">): Promise<({ kind: "found"; txid: string } | { kind: "none" | "ambiguous"; detail: string }) & { tip: number; scanned: number }> {
    const { tip, scanned } = await this.heights();
    const txs = await this.client.transactions(this.account, rec.intentHeight ?? 0);
    const matches = txs.filter((tx) => tx.height <= scanned && paysEveryItem(tx, batch));
    if (matches.length === 1) return { kind: "found", txid: matches[0].txid, tip, scanned };
    if (matches.length > 1) return { kind: "ambiguous", detail: `${matches.length} mined transactions pay this batch: ${matches.map((t) => t.txid).join(", ")}`, tip, scanned };
    return { kind: "none", detail: `no mined transaction of the issuer pays this batch up to scanned height ${scanned} (node tip ${tip})`, tip, scanned };
  }

  async status(txid: string, opts: StatusOptions = {}): Promise<TxStatus> {
    if (!/^[0-9a-f]{64}$/.test(txid)) return { state: "unknown", cause: "malformed_txid", reason: "malformed txid" };
    const { tip, scanned } = await this.heights();
    const entry = await this.store.findByTxid(txid);
    const cur = entry?.record;
    const rec = cur?.txid === txid ? cur : undefined;
    // After `resubmitExpired` the nonce's record belongs to a later attempt; the old txid keeps its index
    // entry, which carries the attempt that wrote it. A later attempt ⇒ superseded; the same attempt ⇒ the
    // record write after the index write was interrupted.
    const superseded = cur !== undefined && rec === undefined && entry!.attempt !== undefined && cur.attempts > entry!.attempt;
    const since = rec?.intentHeight ?? 0;
    const tx = (await this.client.transactions(this.account, since)).find((t) => t.txid === txid);
    if (tx && tx.height > 0) return { state: "mined", height: tx.height, confirmations: tip - tx.height + 1, tip };
    if (superseded) return { state: "unknown", cause: "superseded", reason: `superseded: nonce ${cur.nonce} was re-sent (attempt ${cur.attempts}) after this transaction expired` };
    if (cur && !rec) return { state: "unknown", cause: "interrupted", reason: `nonce ${cur.nonce} does not record this txid yet (an interrupted write); a submit with the same nonce reconciles it` };
    if (!rec?.broadcastAt) return { state: "unknown", cause: "not_ours", reason: "not mined and not broadcast by this console" };
    if (rec.expiresBy !== undefined && scanned > rec.expiresBy) {
      return { state: "unknown", cause: "expired", reason: `expired: not mined by height ${rec.expiresBy} (scanned to ${scanned}), it can no longer be mined; resubmitExpired re-sends under the same nonce` };
    }
    const age = this.now().getTime() - Date.parse(rec.broadcastAt);
    const timeout = opts.pendingTimeoutMs ?? this.pendingTimeoutMs;
    if (age <= timeout) return { state: "pending", broadcastAt: rec.broadcastAt };
    return { state: "unknown", cause: "timeout", reason: `broadcast ${Math.round(age / 60_000)} min ago and still not mined (timeout ${Math.round(timeout / 60_000)} min)` };
  }
}

function paysEveryItem(tx: ZkoolTx, batch: Batch): boolean {
  if (!(tx.height > 0)) return false;
  return batch.items.every((it) => tx.outputs.some((o) => o.address === it.address && o.memo === it.memo && safeZat(o.value) === it.zat));
}

function safeZat(v: string): bigint | null {
  try {
    return decimalToZat(v);
  } catch {
    return null;
  }
}
