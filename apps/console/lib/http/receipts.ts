// Receipt routes (slice D3): issue one verified receipt per batch item once the payment is confirmed, and
// list the stored receipts.
//
// The batch's derived status (slice B3) decides, so issuance can never disagree with what the page shows:
// confirmed or receipts_partial → issue; receipts_issued → the stored receipts (no CLI run); pending or
// confirming → 202 "waiting" (an unconfirmed payment is pending, not invalid: knowledge/19_judges.md §七);
// anything else → 409 with the state and its next action. Failures record nothing (autoIssue writes
// nothing on a mismatch; recordReceipts is atomic) and quote nothing: the CLI's stderr can hold paths.
//
// A receipt's `url` and `receipt` contain the output's OCK: a bearer capability (like Stripe's
// `receipt_url`, a shareable link), returned only here, `no-store`, sealed at rest (slice B2), never logged.

import { batchNonce, getBatch, toExecutionBatch } from "../data/batches.ts";
import { listReceipts, ReceiptRecordError, recordReceipts, type StoredReceipt } from "../data/receipts.ts";
import { getBatchStatus } from "../data/status.ts";
import { StoreBusyError } from "../execution/idempotency.ts";
import { autoIssue, IssuanceMismatchError, ReceiptVerificationError, type ZeceiptCliOptions } from "../issuance/auto-issue.ts";
import type { ConsoleConfig } from "../config/env.ts";
import { serverContext } from "../server/context.ts";
import { HttpProblem, problem } from "./problem.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The issuer's CLI options from the deployment's config: live lightwalletd, no challenge (bearer receipts). */
export function issuerCli(config: ConsoleConfig): ZeceiptCliOptions {
  return { bin: config.issuer.bin, endpoint: config.lightwalletdUrl, ufvkFile: config.issuer.ufvkFile, keyFile: config.issuer.keyFile, keyId: config.issuer.keyId };
}

export function receiptJson(r: StoredReceipt) {
  return {
    idx: r.idx,
    payableId: r.payableId,
    txid: r.txid,
    pool: r.pool,
    outputIndex: r.outputIndex,
    valueZat: r.valueZat.toString(),
    recipient: r.recipient,
    memo: r.memo,
    issuedAt: r.issuedAt,
    verifiedAt: r.verifiedAt,
    ...(r.openError ? { openError: r.openError } : { url: r.url, receipt: r.receipt }),
  };
}

export type ReceiptJson = ReturnType<typeof receiptJson>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function batchOr404(id: string) {
  const ctx = serverContext();
  const rec = UUID_V7.test(id) ? await getBatch(ctx.db, ctx.config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  return rec;
}

/** `POST /api/batches/:id/receipts`: issue (201), already issued (200), waiting (202), or 409 with the state. */
export async function issueReceiptsResponse(id: string, cli: ZeceiptCliOptions): Promise<Response> {
  const ctx = serverContext();
  const backend = ctx.backend;
  if (!backend) throw new HttpProblem(409, "custody_external", "this console runs in external-signer custody and does not track payments, so it cannot issue receipts");
  const rec = await batchOr404(id);
  const status = await getBatchStatus(ctx.db, backend, ctx.config.orgId, rec.id, { requiredConfirmations: ctx.config.confirmations });
  if (!status) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  const list = async () => (await listReceipts(ctx.db, ctx.keyring, ctx.config.orgId, rec.id)).map(receiptJson);
  switch (status.state) {
    case "receipts_issued":
      return json(200, { batchId: rec.id, txid: status.detail.txid, receipts: await list() });
    case "pending":
    case "confirming":
      return json(202, { batchId: rec.id, state: "waiting", confirmations: status.detail.confirmations ?? 0, required: ctx.config.confirmations });
    case "confirmed":
    case "receipts_partial":
      break;
    default:
      throw new HttpProblem(409, "not_ready_for_receipts", "receipts are issued only for a confirmed payment; see state and next", { state: status.state, next: status.next });
  }
  const sub = await backend.store.get(batchNonce(rec));
  const txid = sub?.txid;
  if (!txid) throw new HttpProblem(409, "not_ready_for_receipts", "the batch has no recorded transaction", { state: status.state, next: status.next });
  const issued = await autoIssue({ batch: toExecutionBatch(rec), txid, status: await backend.status(txid), requiredConfirmations: ctx.config.confirmations, cli });
  if (issued.state === "waiting") {
    return json(202, { batchId: rec.id, state: "waiting", confirmations: issued.confirmations, required: issued.required });
  }
  const recorded = await recordReceipts(ctx.db, ctx.keyring, { orgId: ctx.config.orgId, batchId: rec.id, issued });
  return json(201, { batchId: rec.id, txid, inserted: recorded.inserted, existing: recorded.existing, receipts: await list() });
}

/** `GET /api/batches/:id/receipts`: the stored receipts, decrypted (a row that does not open carries `openError`). */
export async function listReceiptsResponse(id: string): Promise<Response> {
  const ctx = serverContext();
  const rec = await batchOr404(id);
  return json(200, { batchId: rec.id, receipts: (await listReceipts(ctx.db, ctx.keyring, ctx.config.orgId, rec.id)).map(receiptJson) });
}

/** Receipt-route failures → problems with fixed details (nothing was recorded in any of them). */
export function receiptsProblem(e: unknown): Response | undefined {
  if (e instanceof IssuanceMismatchError || (e instanceof ReceiptRecordError && e.code === "receipt_mismatch")) {
    return problem(502, "issuance_failed", "zeceipt issue failed or its receipts do not match the batch; nothing was recorded (run zeceipt issue by hand to see why)");
  }
  if (e instanceof ReceiptVerificationError) {
    return problem(502, "receipt_unverified", "an issued receipt did not verify; nothing was recorded");
  }
  if (e instanceof ReceiptRecordError) {
    return problem(409, "not_ready_for_receipts", "the batch's submission changed during issuance; nothing was recorded; check the status");
  }
  if (e instanceof StoreBusyError) return problem(503, "store_busy", "the database is busy; retry shortly", {}, { "Retry-After": "1" });
  return undefined;
}
