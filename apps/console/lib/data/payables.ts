// Payables (slice H3; REQ-CON-3; 05 `payables`): what the org owes, in whole US cents, to one of its recipients.
// The reference becomes the payment's memo, so it is exact (no trimming or normalising here; the page may trim) and
// unique per org, enforced by the database (R78). Types are the route's (400); values are listed here (422);
// a taken reference is a conflict (409). No status is stored: H5 derives it from the batches that include a payable.

import { and, desc, eq, sql } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { payables, recipients } from "../../db/schema.ts";
import { ExecutionError } from "../execution/types.ts";
import { newUuidV7 } from "./batches.ts";
import { payableProblems, type PayableInput, type PayableProblem } from "./payable-validate.ts";

import { PAYABLE_KINDS, REFERENCE_MAX, SOURCE_URL_MAX, USD_CENTS_MAX, type PayableKind } from "./payable-rules.ts";

export { PAYABLE_KINDS, REFERENCE_MAX, SOURCE_URL_MAX, USD_CENTS_MAX, type PayableKind };
export { payableProblems, type PayableInput, type PayableProblem, type PayableProblemCode } from "./payable-validate.ts";

export interface PayableRecord {
  id: string;
  recipientId: string;
  kind: PayableKind;
  usdCents: number;
  reference: string;
  sourceUrl: string | null;
  createdAt: string;
}

export class PayableInvalidError extends ExecutionError {
  readonly problems: PayableProblem[];
  constructor(problems: PayableProblem[]) {
    super("payable_invalid", problems.map((p) => p.detail).join("; "));
    this.problems = problems;
  }
}

/** The reference is already another payable's in this org: its memo would be ambiguous (409). */
export class ReferenceTakenError extends ExecutionError {
  readonly payableId: string;
  constructor(reference: string, payableId: string) {
    super("reference_taken", `reference ${JSON.stringify(reference)} already belongs to payable ${payableId}`);
    this.payableId = payableId;
  }
}

type Row = typeof payables.$inferSelect;
const toRecord = (r: Row): PayableRecord => ({ id: r.id, recipientId: r.recipientId, kind: r.kind, usdCents: r.usdCents, reference: r.reference, sourceUrl: r.sourceUrl, createdAt: r.createdAt });

// Newest first by insertion order, as recipients (H1: UUIDv7 ids within one millisecond do not sort by insertion).
const newestFirst = desc(sql`rowid`);

/** The payable holding `reference` in the org; it exists once the index has refused ours (committed rows only). */
const holderOf = (db: ConsoleDb, orgId: string, reference: string) =>
  db.select({ id: payables.id }).from(payables).where(and(eq(payables.orgId, orgId), eq(payables.reference, reference))).get()?.id;

/** The UNIQUE (org_id, reference) index refused the insert: the reference is taken in this org. */
function isReferenceConflict(e: unknown): boolean {
  for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) {
    const { code, message } = c as { code?: unknown; message?: unknown };
    if (code === "SQLITE_CONSTRAINT_UNIQUE" && typeof message === "string" && message.includes("payables.org_id, payables.reference")) return true;
  }
  return false;
}

export async function createPayable(db: ConsoleDb, input: PayableInput, opts: { now?: () => Date; newId?: () => string } = {}): Promise<PayableRecord> {
  const problems = payableProblems(input);
  const now = (opts.now ?? (() => new Date()))();
  const row: Row = {
    orgId: input.orgId,
    id: (opts.newId ?? (() => newUuidV7(now.getTime())))(),
    recipientId: input.recipientId,
    kind: input.kind,
    usdCents: input.usdCents,
    reference: input.reference,
    sourceUrl: input.sourceUrl ?? null,
    createdAt: now.toISOString(),
  };
  return runSync(() => {
    const known = db.select({ id: recipients.id }).from(recipients).where(and(eq(recipients.orgId, input.orgId), eq(recipients.id, input.recipientId))).get();
    if (!known) problems.push({ code: "recipient_unknown", field: "recipientId", detail: "no recipient with this id in this organisation" });
    if (problems.length) throw new PayableInvalidError(problems);
    // The insert is the check: the UNIQUE (org_id, reference) index refuses a taken reference, whoever took it and
    // whenever (another process between a look-up and an insert included), so there is one path, not two.
    try {
      db.insert(payables).values(row).run();
    } catch (e) {
      if (!isReferenceConflict(e)) throw e;
      throw new ReferenceTakenError(input.reference, holderOf(db, input.orgId, input.reference)!);
    }
    return toRecord(row);
  });
}

/** Every payable of the org, newest first. */
export function listPayables(db: ConsoleDb, orgId: string): Promise<PayableRecord[]> {
  return runSync(() => db.select().from(payables).where(eq(payables.orgId, orgId)).orderBy(newestFirst).all().map(toRecord));
}

export function getPayable(db: ConsoleDb, orgId: string, id: string): Promise<PayableRecord | undefined> {
  return runSync(() => {
    const r = db.select().from(payables).where(and(eq(payables.orgId, orgId), eq(payables.id, id))).get();
    return r ? toRecord(r) : undefined;
  });
}
