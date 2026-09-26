// Recipient directory (slice H1; REQ-CON-2; 05 `recipients`). One address rule with batch items
// (`checkUnifiedAddress` for the console's network); duplicates are flagged on read, never blocked (05); KYC and
// tax are recorded facts, never gates (FLOW-1). Batch items keep copying label and address (B1), so a recipient
// can change later without rewriting what was paid.

import { and, desc, eq, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { recipients } from "../../db/schema.ts";
import { orchardReceiverHex } from "../execution/address.ts";
import { ExecutionError, type Network } from "../execution/types.ts";
import { newUuidV7 } from "./batches.ts";
import { canonicalAddress, recipientProblems, type KycStatus, type RecipientInput, type RecipientProblem, type SettlementPref, type TaxFlag } from "./recipient-validate.ts";

export { canonicalAddress, KYC_STATUSES, recipientProblems, SETTLEMENT_PREFS, TAX_FLAGS, type KycStatus, type RecipientInput, type RecipientProblem, type RecipientProblemCode, type SettlementPref, type TaxFlag } from "./recipient-validate.ts";

export interface RecipientRecord {
  id: string;
  displayName: string;
  address: string;
  network: Network;
  kycStatus: KycStatus;
  taxFlag: TaxFlag;
  settlementPref: SettlementPref;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Other recipients of the org paying the same place: the same Orchard receiver (flagged, not blocked), newest first. */
  duplicateOf: string[];
}

export class RecipientInvalidError extends ExecutionError {
  readonly problems: RecipientProblem[];
  constructor(problems: RecipientProblem[]) {
    super("recipient_invalid", problems.map((p) => p.detail).join("; "));
    this.problems = problems;
  }
}

type Row = typeof recipients.$inferSelect;
const toRecord = (r: Row, duplicateOf: string[]): RecipientRecord => ({
  id: r.id, displayName: r.displayName, address: r.address, network: r.network, kycStatus: r.kycStatus, taxFlag: r.taxFlag,
  settlementPref: r.settlementPref, notes: r.notes, createdAt: r.createdAt, updatedAt: r.updatedAt, duplicateOf,
});

export async function createRecipient(db: ConsoleDb, input: RecipientInput, opts: { now?: () => Date; newId?: () => string } = {}): Promise<RecipientRecord> {
  const problems = recipientProblems(input);
  if (problems.length) throw new RecipientInvalidError(problems);
  const now = (opts.now ?? (() => new Date()))();
  const row: Row = {
    orgId: input.orgId,
    id: (opts.newId ?? (() => newUuidV7(now.getTime())))(),
    displayName: input.displayName,
    address: canonicalAddress(input.address)!,
    network: input.network,
    kycStatus: input.kycStatus ?? "unknown",
    taxFlag: input.taxFlag ?? "none",
    settlementPref: input.settlementPref ?? "zec",
    notes: input.notes ?? "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return runSync(() => {
    db.insert(recipients).values(row).run();
    return toRecord(row, sameDestination(db, row.orgId, row));
  });
}

// Newest first by insertion order (SQLite's rowid). UUIDv7 ids created within one millisecond differ only in
// random bits, so ordering by id is not insertion order (found while fixing review H1: the test was flaky).
const newestFirst = desc(sql`rowid`);

/**
 * Where a payment to this address actually goes: its Orchard receiver (the one this console pays). Two different
 * unified addresses holding the same Orchard receiver pay the same place, so they are duplicates too (review H1;
 * it also feeds the linkability warning, H6). Stored addresses were validated, so they decode.
 */
function payTo(address: string, network: Network): string {
  return orchardReceiverHex(address, network) ?? `address:${address}`;
}

/** Other recipients of the org paying the same place, newest first (review H1: one order everywhere). */
function sameDestination(db: ConsoleDb, orgId: string, row: Pick<Row, "id" | "address" | "network">): string[] {
  const key = payTo(row.address, row.network);
  return db.select({ id: recipients.id, address: recipients.address, network: recipients.network }).from(recipients).where(eq(recipients.orgId, orgId)).orderBy(newestFirst).all()
    .filter((r) => r.id !== row.id && payTo(r.address, r.network) === key).map((r) => r.id);
}

/** Every recipient of the org, newest first, each with its duplicates (newest first too). */
export function listRecipients(db: ConsoleDb, orgId: string): Promise<RecipientRecord[]> {
  return runSync(() => {
    const rows = db.select().from(recipients).where(eq(recipients.orgId, orgId)).orderBy(newestFirst).all();
    const byDestination = new Map<string, string[]>();
    const keys = rows.map((r) => payTo(r.address, r.network));
    rows.forEach((r, k) => byDestination.set(keys[k], [...(byDestination.get(keys[k]) ?? []), r.id]));
    return rows.map((r, k) => toRecord(r, byDestination.get(keys[k])!.filter((id) => id !== r.id)));
  });
}

export function getRecipient(db: ConsoleDb, orgId: string, id: string): Promise<RecipientRecord | undefined> {
  return runSync(() => {
    const r = db.select().from(recipients).where(and(eq(recipients.orgId, orgId), eq(recipients.id, id))).get();
    if (!r) return undefined;
    return toRecord(r, sameDestination(db, orgId, r));
  });
}
