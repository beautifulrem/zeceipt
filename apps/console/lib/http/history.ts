// `GET /api/batches/{id}/history` (slice I4): the batch's audit trail, oldest first; 404 for an unknown batch.

import { listAudit } from "../data/audit.ts";
import { getBatch } from "../data/batches.ts";
import { serverContext } from "../server/context.ts";
import { HttpProblem } from "./problem.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function historyResponse(id: string): Promise<Response> {
  const { config, db } = serverContext();
  const rec = UUID_V7.test(id) ? await getBatch(db, config.orgId, id) : undefined;
  if (!rec) throw new HttpProblem(404, "batch_not_found", "no batch with this id");
  const events = await listAudit(db, config.orgId, rec.id);
  return new Response(JSON.stringify({ batchId: rec.id, events }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
