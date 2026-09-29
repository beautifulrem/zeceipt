// The audit trail (slice I4): read the events the triggers of
// migration 0021 wrote for a batch, oldest first. The triggers write in the same transaction as each change, so the
// history is never ahead of or behind what it describes (R89).

import { and, asc, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { auditLog } from "../../db/schema.ts";

export interface AuditEvent {
  id: number;
  at: string;
  /** created, locked, quoted, approved, attempt_<state>, expiry_recorded, voided, receipt_issued */
  action: string;
  detail: Record<string, unknown>;
}

export function listAudit(db: ConsoleDb, orgId: string, batchId: string): Promise<AuditEvent[]> {
  return runSync(() =>
    db.select().from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.batchId, batchId)))
      .orderBy(asc(auditLog.id)).all()
      .map((r) => ({ id: r.id, at: r.at, action: r.action, detail: JSON.parse(r.detail) as Record<string, unknown> })),
  );
}
