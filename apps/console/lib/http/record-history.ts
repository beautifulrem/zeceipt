// `GET /api/recipients/{id}/history` and `GET /api/payables/{id}/history` (slice I4b): the record's trail, oldest first.
// 404 when there is no such record and no event for it either: a deleted record's history stays readable by its id
// (design I4b.3.1). The not-found codes are the ones the record routes already answer.

import { listRecordLog, type RecordKind } from "../data/record-log.ts";
import { getPayable } from "../data/payables.ts";
import { getRecipient } from "../data/recipients.ts";
import { serverContext } from "../server/context.ts";
import { problem } from "./problem.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function recordHistoryResponse(kind: RecordKind, id: string): Promise<Response> {
  const { config, db } = serverContext();
  const notFound = () => (kind === "recipient" ? problem(404, "recipient_not_found", "no recipient with this id") : problem(404, "payable_not_found", "no payable with this id"));
  if (!UUID_V7.test(id)) return notFound();
  const events = await listRecordLog(db, config.orgId, kind, id);
  if (events.length === 0) {
    const exists = kind === "recipient" ? await getRecipient(db, config.orgId, id) : await getPayable(db, config.orgId, id);
    if (!exists) return notFound();
  }
  return new Response(JSON.stringify({ kind, id, events }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
