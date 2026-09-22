// PayoutBackend for Zkool GraphQL (primary execution backend, REQ-CON-7; measured in PROOF §5b/§5c).

import { checkUnifiedAddress } from "./address.ts";
import { estimateIronwoodFeeZat } from "./fee.ts";
import { batchDigest, type IdempotencyStore, type SubmissionRecord } from "./idempotency.ts";
import { decimalToZat } from "./money.ts";
import {
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
  /** A `submitting` record younger than this is treated as in flight. Default 10 min (> pay timeout). */
  inFlightMs?: number;
  /** Default pending timeout for `status`. Default 30 min. */
  pendingTimeoutMs?: number;
  maxRecipients?: number;
  now?: () => Date;
}

const MEMO_MAX_BYTES = 512;

export class ZkoolBackend implements PayoutBackend {
  readonly name = "zkool-graphql" as const;
  private readonly client: ZkoolClient;
  private readonly account: number;
  private readonly store: IdempotencyStore;
  private readonly inFlightMs: number;
  private readonly pendingTimeoutMs: number;
  private readonly maxRecipients: number;
  private readonly now: () => Date;

  constructor(opts: ZkoolBackendOptions) {
    this.client = opts.client;
    this.account = opts.account;
    this.store = opts.store;
    this.inFlightMs = opts.inFlightMs ?? 10 * 60_000;
    this.pendingTimeoutMs = opts.pendingTimeoutMs ?? 30 * 60_000;
    this.maxRecipients = opts.maxRecipients ?? 50;
    this.now = opts.now ?? (() => new Date());
  }

  /** Static checks that need no network; also used inside `preflight`. */
  staticProblems(batch: Batch): PreflightProblem[] {
    const problems: PreflightProblem[] = [];
    if (batch.items.length === 0) problems.push({ code: "empty_batch", detail: "batch has no items" });
    if (batch.items.length > this.maxRecipients) {
      problems.push({ code: "too_many_recipients", detail: `${batch.items.length} recipients > limit ${this.maxRecipients}` });
    }
    const payables = new Set<string>();
    const memos = new Set<string>();
    batch.items.forEach((it, i) => {
      const a = checkUnifiedAddress(it.address, batch.network);
      if (!a.ok) problems.push({ code: a.code, itemIndex: i, detail: a.detail });
      if (it.zat <= 0n) problems.push({ code: "amount_nonpositive", itemIndex: i, detail: `amount ${it.zat} zat` });
      const bytes = Buffer.byteLength(it.memo, "utf8");
      if (bytes > MEMO_MAX_BYTES) problems.push({ code: "memo_too_long", itemIndex: i, detail: `${bytes} bytes > ${MEMO_MAX_BYTES}` });
      if (payables.has(it.payableId)) problems.push({ code: "duplicate_payable", itemIndex: i, detail: `payable ${it.payableId} appears twice` });
      payables.add(it.payableId);
      // Memos are payable references (unique per org, REQ-CON-3) and the key for reconciliation.
      if (memos.has(it.memo)) problems.push({ code: "memo_duplicate", itemIndex: i, detail: `memo ${JSON.stringify(it.memo)} appears twice` });
      memos.add(it.memo);
    });
    return problems;
  }

  async preflight(batch: Batch): Promise<Preflight> {
    const problems = this.staticProblems(batch);
    const totalZat = batch.items.reduce((s, it) => s + (it.zat > 0n ? it.zat : 0n), 0n);
    const feeEstimateZat = estimateIronwoodFeeZat(batch.items.length);
    const height = await this.client.sync(this.account);
    const bal = await this.client.balance(this.account);
    const spendableZat = decimalToZat(bal.ironwood);
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
        case "failed_retryable": {
          // The backend refused last time, so nothing was broadcast. Retry under the same nonce, but only
          // one caller may claim each attempt number (two concurrent retries must not both pay).
          const attempt = existing.attempts + 1;
          if (!(await this.store.claimAttempt(nonce, attempt))) throw new SubmissionInFlightError(nonce, 0);
          const retry: SubmissionRecord = { ...existing, state: "submitting", attempts: attempt, error: undefined, createdAt: this.now().toISOString() };
          await this.store.put(retry);
          return this.pay(batch, retry);
        }
      }
    }
    return this.pay(batch, intent);
  }

  /** We hold the intent for `rec`. Preflight, pay, record the outcome. */
  private async pay(batch: Batch, rec: SubmissionRecord): Promise<Submitted> {
    let pre: Preflight;
    try {
      pre = await this.preflight(batch);
    } catch (e) {
      // Nothing was sent yet; leave the nonce retryable.
      await this.store.put({ ...rec, state: "failed_retryable", error: `preflight error: ${(e as Error).message}` });
      throw e;
    }
    if (!pre.ok) {
      await this.store.put({ ...rec, state: "failed_retryable", error: `preflight: ${pre.problems.map((p) => p.code).join(",")}` });
      throw new PreflightFailedError(pre.problems);
    }
    const intentRec: SubmissionRecord = { ...rec, intentHeight: pre.height };
    await this.store.put(intentRec);
    let txid: string;
    try {
      txid = await this.client.pay(this.account, batch.items.map((i) => ({ address: i.address, zat: i.zat, memo: i.memo })), POOL.ironwood);
    } catch (e) {
      if (e instanceof ZkoolGraphqlError) {
        await this.store.put({ ...intentRec, state: "failed_retryable", error: e.message });
        throw new PaymentRejectedError(e.message);
      }
      await this.store.put({ ...intentRec, state: "unknown_outcome", error: (e as Error).message });
      throw new UnknownOutcomeError(rec.nonce, (e as Error).message);
    }
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      await this.store.put({ ...intentRec, state: "unknown_outcome", error: `pay returned a malformed txid ${JSON.stringify(txid)}` });
      throw new UnknownOutcomeError(rec.nonce, "pay returned a malformed txid");
    }
    await this.store.put({ ...intentRec, state: "broadcast", txid, broadcastAt: this.now().toISOString(), error: undefined });
    return { txid, replayed: false, via: "fresh" };
  }

  /** The payment may or may not have happened. Look for it on chain; never pay again blindly. */
  private async resolveUncertain(batch: Batch, rec: SubmissionRecord, why: string): Promise<Submitted> {
    const match = await this.reconcile(batch, rec);
    if (match.kind === "found") {
      await this.store.put({ ...rec, state: "broadcast", txid: match.txid, broadcastAt: rec.broadcastAt ?? this.now().toISOString(), error: undefined });
      return { txid: match.txid, replayed: true, via: "reconciled" };
    }
    await this.store.put({ ...rec, state: "unknown_outcome", error: `${why}; ${match.detail}` });
    throw new UnknownOutcomeError(rec.nonce, `${why}; ${match.detail}`);
  }

  /**
   * Find a mined transaction of the issuing account (at or after the intent height) whose outputs pay
   * every batch item: same memo and same value. Memos are unique payable references, so one match is
   * decisive; several matches or none are reported for a human to resolve.
   */
  async reconcile(batch: Batch, rec: Pick<SubmissionRecord, "intentHeight">): Promise<{ kind: "found"; txid: string } | { kind: "none" | "ambiguous"; detail: string }> {
    await this.client.sync(this.account);
    const txs = await this.client.transactions(this.account, rec.intentHeight ?? 0);
    const matches = txs.filter((tx) => paysEveryItem(tx, batch));
    if (matches.length === 1) return { kind: "found", txid: matches[0].txid };
    if (matches.length > 1) return { kind: "ambiguous", detail: `${matches.length} mined transactions pay this batch: ${matches.map((t) => t.txid).join(", ")}` };
    return { kind: "none", detail: "no mined transaction of the issuer pays this batch yet (it may still be in the mempool; check again after the next block)" };
  }

  async status(txid: string, opts: StatusOptions = {}): Promise<TxStatus> {
    if (!/^[0-9a-f]{64}$/.test(txid)) return { state: "unknown", reason: "malformed txid" };
    const tip = await this.client.sync(this.account);
    const rec = await this.store.findByTxid(txid);
    const since = rec?.intentHeight ?? 0;
    const tx = (await this.client.transactions(this.account, since)).find((t) => t.txid === txid);
    if (tx && tx.height > 0) return { state: "mined", height: tx.height, confirmations: tip - tx.height + 1, tip };
    if (!rec?.broadcastAt) return { state: "unknown", reason: "not mined and not broadcast by this console" };
    const age = this.now().getTime() - Date.parse(rec.broadcastAt);
    const timeout = opts.pendingTimeoutMs ?? this.pendingTimeoutMs;
    if (age <= timeout) return { state: "pending", broadcastAt: rec.broadcastAt };
    return { state: "unknown", reason: `broadcast ${Math.round(age / 60_000)} min ago and still not mined (timeout ${Math.round(timeout / 60_000)} min)` };
  }
}

function paysEveryItem(tx: ZkoolTx, batch: Batch): boolean {
  if (!(tx.height > 0)) return false;
  return batch.items.every((it) => tx.outputs.some((o) => o.memo === it.memo && safeZat(o.value) === it.zat));
}

function safeZat(v: string): bigint | null {
  try {
    return decimalToZat(v);
  } catch {
    return null;
  }
}
