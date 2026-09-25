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
}

/** One pass over the org's batches: issue what is ready, leave the rest; one batch's failure never stops the pass. */
export async function receiptPass(opts: { cli?: ZeceiptCliOptions } = {}): Promise<PassResult> {
  const ctx = serverContext();
  const out: PassResult = { issued: [], existing: [], failed: [] };
  const backend = ctx.backend;
  if (!backend) return out; // external custody: the console does not track payments (and runs no worker)
  const cli = opts.cli ?? issuerCli(ctx.config);
  for (const b of await listBatches(ctx.db, ctx.config.orgId)) {
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
 */
export function startReceiptWorker(opts: {
  intervalMs: number;
  pass?: () => Promise<PassResult>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
}): ReceiptWorker {
  const pass = opts.pass ?? (() => receiptPass());
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const controller = new AbortController();
  const loop = (async () => {
    while (!controller.signal.aborted) {
      try {
        const r = await pass();
        for (const id of r.issued) log(`receipts: issued for batch ${id}`);
        for (const f of r.failed) log(`receipts: batch ${f.batchId} not issued (${f.code}); retrying next pass`);
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
