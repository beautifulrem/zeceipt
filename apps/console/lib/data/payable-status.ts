// Where each payable is (slice H5b; design H5b.1.6): free, or held by a batch, derived from the batch lines, never
// stored (H3.1.6). "Held" is the rule H5a's `payable_taken` applies: a line that names the payable (payable_ref),
// or a hand-made line with its id or its reference as the memo (review H5a round 1). A voided batch holds nothing (H5c).

import { and, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batchItems, batches, payables } from "../../db/schema.ts";
import { liveLine } from "./batches.ts";

export interface PayableHolder {
  batchId: string;
  title: string;
}

/** Payable id → the batch holding it; a payable absent from the map is free. */
export function payableHolders(db: ConsoleDb, orgId: string): Promise<Map<string, PayableHolder>> {
  return runSync(() => {
    const owed = db.select({ id: payables.id, reference: payables.reference }).from(payables).where(eq(payables.orgId, orgId)).all();
    const lines = db.select({ ref: batchItems.payableRef, payableId: batchItems.payableId, memo: batchItems.memo, batchId: batchItems.batchId, title: batches.title })
      .from(batchItems)
      .innerJoin(batches, and(eq(batches.orgId, batchItems.orgId), eq(batches.id, batchItems.batchId)))
      .where(and(eq(batchItems.orgId, orgId), liveLine)).all();
    const byRef = new Map<string, PayableHolder>();
    const byId = new Map<string, PayableHolder>();
    const byMemo = new Map<string, PayableHolder>();
    for (const l of lines) {
      const h = { batchId: l.batchId, title: l.title };
      if (l.ref) byRef.set(l.ref, h);
      byId.set(l.payableId, h);
      byMemo.set(l.memo, h);
    }
    const out = new Map<string, PayableHolder>();
    for (const p of owed) {
      const h = byRef.get(p.id) ?? byId.get(p.id) ?? byMemo.get(p.reference);
      if (h) out.set(p.id, h);
    }
    return out;
  });
}
