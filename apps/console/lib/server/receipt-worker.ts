// Automatic receipt issuance (slice I2; REQ-CON-11; design I2.1; R86). BTCPay's automated payout processors run a
// loop: query what is actionable, act through the one path, sleep an interval. Here: every batch whose derived status
// says `issue_receipts` (B3) is issued through the same idempotent handler as the page's button and the route (D3),
// so the worker and a person can never record a receipt twice. Started from `instrumentation.ts`' register (Next.js
// calls it once per server instance), hot custody only. Logs name batches and problem codes, never CLI output or a
// receipt (a receipt carries the output's key: a bearer secret).

import { countReceipts } from "../data/receipts.ts";
import { listBatches } from "../data/batches.ts";
import { getBatchStatus } from "../data/status.ts";
import type { ZeceiptCliOptions } from "../issuance/auto-issue.ts";
import { issueReceiptsResponse, issuerCli, receiptsProblem } from "../http/receipts.ts";
import { answer } from "../http/route.ts";
import { approvalCheck, serverContext } from "./context.ts";

export interface PassResult {
  /** Batches whose receipts this pass recorded (201). */
  issued: string[];
  /** Batches the handler found already complete (200). */
  existing: string[];
  /** Batches that could not be issued, with the problem code (issuance_failed, receipt_unverified, store_busy, …). */
  failed: { batchId: string; code: string }[];
  /** Every batch the pass looked at and did not skip (slice I2b): those not in `failed` are not failing now. */
  considered: string[];
}

/**
 * One pass over the org's batches: issue what is ready, leave the rest; one batch's failure never stops the pass.
 * `skip` names batches backing off (slice I2b): they are not looked at, so the chain is not asked about them.
 */
export async function receiptPass(opts: { cli?: ZeceiptCliOptions; skip?: ReadonlySet<string> } = {}): Promise<PassResult> {
  const ctx = serverContext();
  const out: PassResult = { issued: [], existing: [], failed: [], considered: [] };
  const backend = ctx.backend;
  if (!backend) return out; // external custody: the console does not track payments (and runs no worker)
  const cli = opts.cli ?? issuerCli(ctx.config);
  for (const b of await listBatches(ctx.db, ctx.config.orgId)) {
    if (opts.skip?.has(b.id)) continue;
    out.considered.push(b.id);
    // Cheap skips before asking the chain (design I2.1.3): voided, or already one receipt per line.
    if (b.voided || (await countReceipts(ctx.db, ctx.config.orgId, b.id)) >= b.itemCount) continue;
    try {
      const status = await getBatchStatus(ctx.db, backend, ctx.config.orgId, b.id, { requiredConfirmations: ctx.config.confirmations, approval: approvalCheck(ctx) });
      if (status?.next !== "issue_receipts") continue;
      const res = await answer(() => issueReceiptsResponse(b.id, cli), receiptsProblem);
      if (res.status === 201) out.issued.push(b.id);
      else if (res.status === 200) out.existing.push(b.id);
      else out.failed.push({ batchId: b.id, code: ((await res.json()) as { code?: string }).code ?? `http_${res.status}` });
    } catch (e) {
      // Reading the status failed (the wallet or the store): this batch waits for the next pass.
      out.failed.push({ batchId: b.id, code: (e as { code?: string } | null)?.code ?? "status_unavailable" });
    }
  }
  return out;
}

/** Passes to wait after a batch's n-th consecutive failure (slice I2b; R88): 1, 2, 4, 8, 16, then 32 at most. */
export function backoffPasses(failures: number): number {
  return Math.min(2 ** Math.max(0, failures - 1), MAX_BACKOFF_PASSES);
}
/** About half an hour at the default 60 s; a person's Issue button works at any time, so a longer wait only delays automation. */
export const MAX_BACKOFF_PASSES = 32;

export interface ReceiptWorker {
  /** Ends the loop after the current pass (if any); resolves once it has ended. */
  stop(): Promise<void>;
}

/** Wait `ms`, or less if `signal` aborts; the timer never keeps the process alive. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/**
 * Run passes forever, `intervalMs` apart, until stopped. The wait starts after a pass ends, so passes never overlap
 * (BTCPay's `Task.Delay` after `Act`); a pass that throws is logged and the loop goes on.
 *
 * Slice I2b (review I2's optional; R88): a batch that keeps failing is tried again after 1, 2, 4 … 32 passes (capped
 * exponential backoff, no jitter: one worker, nothing contends), and its failure is logged when it starts or its code
 * changes, never on a repeat; a recovery is logged once. The record is in memory: a restart starts fresh.
 */
export function startReceiptWorker(opts: {
  intervalMs: number;
  pass?: (skip: ReadonlySet<string>) => Promise<PassResult>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
}): ReceiptWorker {
  const pass = opts.pass ?? ((skip: ReadonlySet<string>) => receiptPass({ skip }));
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const controller = new AbortController();
  // Per batch: consecutive failed passes, the last code, and the first pass number it may be tried again.
  const failing = new Map<string, { failures: number; code: string; nextPass: number }>();
  let n = 0;
  const loop = (async () => {
    while (!controller.signal.aborted) {
      n++;
      try {
        const skip = new Set([...failing].filter(([, f]) => f.nextPass > n).map(([id]) => id));
        const r = await pass(skip);
        const failed = new Map(r.failed.map((f) => [f.batchId, f.code]));
        for (const id of r.issued) {
          const before = failing.get(id)?.failures;
          log(before ? `receipts: issued for batch ${id} after ${before} failed ${before === 1 ? "pass" : "passes"}` : `receipts: issued for batch ${id}`);
        }
        // Looked at and not failing (issued, already complete, not ready, voided): forget it.
        for (const id of r.considered) if (!failed.has(id)) failing.delete(id);
        for (const [id, code] of failed) {
          const prev = failing.get(id);
          const failures = (prev?.failures ?? 0) + 1;
          const wait = backoffPasses(failures);
          failing.set(id, { failures, code, nextPass: n + wait });
          if (prev?.code !== code) log(`receipts: batch ${id} not issued (${code}); retrying in ${wait} ${wait === 1 ? "pass" : "passes"}`);
        }
      } catch (e) {
        log(`receipts: pass failed (${(e as { code?: string } | null)?.code ?? "error"}); retrying next pass`);
      }
      if (controller.signal.aborted) break;
      await sleep(opts.intervalMs, controller.signal);
    }
  })();
  return {
    stop: async () => {
      controller.abort();
      await loop;
    },
  };
}
