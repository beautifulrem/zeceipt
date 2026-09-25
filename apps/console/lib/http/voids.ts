// `POST /api/batches/{id}/void` (slice H5c; R82: Stripe's `POST /v1/invoices/{id}/void`, final and kept): 200 with the
// voided batch; 404 for an unknown id; 409 `batch_frozen` when an attempt may have paid, `batch_voided` when already
// voided; 503 when the store is busy. Mapped by `code` (E1).

import { voidBatch } from "../data/voids.ts";
import { serverContext } from "../server/context.ts";
import { batchJson } from "./batches.ts";
import { problem } from "./problem.ts";
import { rateLockJson } from "./rates.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function voidsProblem(e: unknown): Response | undefined {
  const err = e as { code?: unknown; message?: unknown } | null;
  const detail = typeof err?.message === "string" ? err.message : "";
  if (err?.code === "batch_not_found") return problem(404, "batch_not_found", "no batch with this id");
  if (err?.code === "batch_frozen") return problem(409, "batch_frozen", `${detail}; nothing was changed`);
  if (err?.code === "batch_voided") return problem(409, "batch_voided", "the batch is already voided; nothing was changed");
  if (err?.code === "store_busy") return problem(503, "store_busy", "the database is busy; nothing was voided; retry shortly", {}, { "Retry-After": "1" });
  return undefined;
}

export async function voidBatchResponse(id: string): Promise<Response> {
  const { config, db } = serverContext();
  if (!UUID_V7.test(id)) return problem(404, "batch_not_found", "no batch with this id");
  const rec = await voidBatch(db, config.orgId, id);
  return new Response(JSON.stringify(batchJson(rec, await rateLockJson(config.orgId, rec.id))), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
