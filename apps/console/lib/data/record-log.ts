// The trail of recipients and payables (slice I4b): read the
// events the triggers of migration 0022 wrote for one record, oldest first. A change's `fields` holds
// {previous, current} for each tracked field that changed; the triggers write null for the others, dropped here.

import { and, asc, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { recordLog } from "../../db/schema.ts";

export type RecordKind = "recipient" | "payable";

export interface RecordEvent {
  id: number;
  at: string;
  action: "created" | "changed" | "deleted";
  detail: Record<string, unknown>;
}

function withoutUnchanged(detail: Record<string, unknown>): Record<string, unknown> {
  const fields = detail.fields;
  if (!fields || typeof fields !== "object") return detail;
  return { ...detail, fields: Object.fromEntries(Object.entries(fields as Record<string, unknown>).filter(([, v]) => v !== null)) };
}

export function listRecordLog(db: ConsoleDb, orgId: string, kind: RecordKind, recordId: string): Promise<RecordEvent[]> {
  return runSync(() =>
    db.select().from(recordLog)
      .where(and(eq(recordLog.orgId, orgId), eq(recordLog.kind, kind), eq(recordLog.recordId, recordId)))
      .orderBy(asc(recordLog.id)).all()
      .map((r) => ({ id: r.id, at: r.at, action: r.action, detail: withoutUnchanged(JSON.parse(r.detail) as Record<string, unknown>) })),
  );
}
