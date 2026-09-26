// The OpenZcash export route (slice X2b; REQ-INT-2; `05` §3.1): the batch's issued receipts as the CSV OpenZcash's own
// "Export CSV" writes (X2a), downloaded on an explicit request. Every Receipt cell carries that output's OCK, so the
// file discloses each listed payment to whoever holds it, permanently (spec §9): it is `no-store`, never logged, and
// each download is recorded in the audit log with its format and row count only. A batch with no receipt, or with a
// receipt that does not open, is refused rather than exported with rows missing.

import { auditLog } from "../../db/schema.ts";
import { runSync } from "../../db/errors.ts";
import { getBatch } from "../data/batches.ts";
import { exportLines } from "../data/export.ts";
import { OPENZCASH_HEADER, openZcashRow, toCsv } from "../export/openzcash.ts";
import { serverContext } from "../server/context.ts";
import { StoreBusyError } from "../execution/idempotency.ts";
import { crossSiteProblem } from "./guard.ts";
import { HttpProblem, problem } from "./problem.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `GET /api/batches/:id/exports/openzcash`: 200 with the CSV, 403 from another site, 404, or 409 (`no_receipts`, `receipt_unreadable`). */
export async function openZcashExportResponse(id: string, headers: Headers, now: () => Date = () => new Date()): Promise<Response> {
  const refused = crossSiteProblem(headers, "the export holds receipt links: download it from this console's own page");
  if (refused) return refused;
  const ctx = serverContext();
  const orgId = ctx.config.orgId;
  const batch = UUID_V7.test(id) ? await getBatch(ctx.db, orgId, id) : undefined;
  if (!batch) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  const { lines, unreadable, batchLines } = await exportLines(ctx.db, ctx.keyring, orgId, batch.id, ctx.config.receiptHost);
  if (unreadable.length > 0) {
    throw new HttpProblem(409, "receipt_unreadable", "a stored receipt of this batch does not open (unknown key or damaged); nothing was exported", { items: unreadable });
  }
  if (lines.length === 0) {
    throw new HttpProblem(409, "no_receipts", "this batch has no issued receipt yet; issue its receipts after the payment confirms, then export");
  }
  const body = toCsv(OPENZCASH_HEADER, lines.map(openZcashRow));
  await runSync(() =>
    ctx.db.insert(auditLog).values({ orgId, batchId: batch.id, at: now().toISOString(), action: "exported", detail: JSON.stringify({ format: "openzcash", rows: lines.length }) }).run(),
  );
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zeceipt-openzcash-${batch.id}.csv"`,
      "Cache-Control": "no-store",
      // Rows and the batch's lines, so a partial export (receipts not all issued) is visible to the caller.
      "X-Zeceipt-Rows": String(lines.length),
      "X-Zeceipt-Lines": String(batchLines),
    },
  });
}

/** A busy database is retryable (503 with Retry-After), as on the receipt routes; nothing was exported or recorded. */
export function exportProblem(e: unknown): Response | undefined {
  if (e instanceof StoreBusyError) return problem(503, "store_busy", "the database is busy; retry shortly", {}, { "Retry-After": "1" });
  return undefined;
}
