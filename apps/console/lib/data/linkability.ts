// Linkability (slice H6; REQ-CON-6; spec §9; R84): a receipt discloses its output's diversified address, so paying the
// same address again, and receipting it, links the two payments for anyone holding both receipts. "The same address"
// is the same Orchard receiver (H1's rule): a stored receipt's recipient is an Orchard-only UA for its output
// (zeceipt-core `encode_orchard_address`), decoded for its batch's network. Computed on read, never stored (H6.1.5).

import { and, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { batches, receipts } from "../../db/schema.ts";
import { orchardReceiverHex } from "../execution/address.ts";
import type { Network } from "../execution/types.ts";
import type { BatchRecord } from "./batches.ts";

/** A batch whose receipt disclosed an address. */
export interface Discloser {
  batchId: string;
  title: string;
}

/** Orchard receiver (hex) → the batches whose receipts disclosed it (each once, in receipt order). */
export function disclosedReceivers(db: ConsoleDb, orgId: string): Promise<Map<string, Discloser[]>> {
  return runSync(() => {
    const rows = db.select({ recipient: receipts.recipient, batchId: receipts.batchId, title: batches.title, network: batches.network })
      .from(receipts)
      .innerJoin(batches, and(eq(batches.orgId, receipts.orgId), eq(batches.id, receipts.batchId)))
      .where(eq(receipts.orgId, orgId)).all();
    return indexDisclosures(rows);
  });
}

/** Pure: stored receipts (recipient, its batch and network) → Orchard receiver (hex) → the batches that disclosed it. */
export function indexDisclosures(rows: { recipient: string; batchId: string; title: string; network: Network }[]): Map<string, Discloser[]> {
  const out = new Map<string, Discloser[]>();
  for (const r of rows) {
    // A receipt that does not decode to an Orchard receiver (Sapling, or damaged) cannot match an Orchard payment.
    const key = orchardReceiverHex(r.recipient, r.network);
    if (!key) continue;
    const list = out.get(key) ?? [];
    if (!list.some((d) => d.batchId === r.batchId)) list.push({ batchId: r.batchId, title: r.title });
    out.set(key, list);
  }
  return out;
}

/** Who disclosed this address (excluding `exceptBatch`, a batch's own receipts); empty when nobody did. */
export function disclosersOf(disclosed: Map<string, Discloser[]>, address: string, network: Network, exceptBatch?: string): Discloser[] {
  const key = orchardReceiverHex(address, network);
  return key ? (disclosed.get(key) ?? []).filter((d) => d.batchId !== exceptBatch) : [];
}

/** The batch validation report's linkability part: each line paying an address another batch's receipt disclosed. */
export function batchLinkability(disclosed: Map<string, Discloser[]>, rec: Pick<BatchRecord, "id" | "network" | "items">): { idx: number; disclosedBy: Discloser[] }[] {
  return rec.items
    .map((i) => ({ idx: i.idx, disclosedBy: disclosersOf(disclosed, i.address, rec.network, rec.id) }))
    .filter((l) => l.disclosedBy.length > 0);
}
