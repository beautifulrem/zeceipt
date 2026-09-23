// Recipient directory (slice H1; REQ-CON-2; 05 `recipients`). One address rule with batch items
// (`checkUnifiedAddress` for the console's network); duplicates are flagged on read, never blocked (05); KYC and
// tax are recorded facts, never gates (FLOW-1). Batch items keep copying label and address (B1), so a recipient
// can change later without rewriting what was paid.

import { and, desc, eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { recipients } from "../../db/schema.ts";
import { checkUnifiedAddress } from "../execution/address.ts";
import { ExecutionError, type Network } from "../execution/types.ts";
import { newBatchId } from "./batches.ts";
import { isPlainText } from "./text.ts";

export const KYC_STATUSES = ["unknown", "verified", "not_required"] as const;
export const TAX_FLAGS = ["none", "us_1099", "non_us"] as const;
export const SETTLEMENT_PREFS = ["zec", "usdc_sol"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export type TaxFlag = (typeof TAX_FLAGS)[number];
export type SettlementPref = (typeof SETTLEMENT_PREFS)[number];

export interface RecipientInput {
  orgId: string;
  network: Network;
  displayName: string;
  address: string;
  kycStatus?: KycStatus;
  taxFlag?: TaxFlag;
  settlementPref?: SettlementPref;
  notes?: string;
}

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
  /** Other recipients of the org with the same address (flagged, not blocked). */
  duplicateOf: string[];
}

export type RecipientProblemCode = "name_invalid" | "address_hrp" | "address_checksum" | "address_case" | "kyc_invalid" | "tax_invalid" | "settlement_invalid" | "notes_invalid";
export interface RecipientProblem {
  code: RecipientProblemCode;
  field: "displayName" | "address" | "kycStatus" | "taxFlag" | "settlementPref" | "notes";
  detail: string;
}

export class RecipientInvalidError extends ExecutionError {
  readonly problems: RecipientProblem[];
  constructor(problems: RecipientProblem[]) {
    super("recipient_invalid", problems.map((p) => p.detail).join("; "));
    this.problems = problems;
  }
}

/**
 * Bech32m is case-insensitive only in a single case: an all-upper-case address (as QR codes carry it) is the same
 * address lowercased; mixed case is not an address.
 */
function canonicalAddress(a: string): string | undefined {
  if (a === a.toLowerCase()) return a;
  if (a === a.toUpperCase()) return a.toLowerCase();
  return undefined;
}

export function recipientProblems(input: RecipientInput): RecipientProblem[] {
  const problems: RecipientProblem[] = [];
  if (!isPlainText(input.displayName, 1, 200)) problems.push({ code: "name_invalid", field: "displayName", detail: "display name must be 1–200 characters of plain text" });
  const address = canonicalAddress(input.address);
  if (address === undefined) {
    problems.push({ code: "address_case", field: "address", detail: "the address mixes upper and lower case (a unified address is all one case)" });
  } else {
    const check = checkUnifiedAddress(address, input.network);
    if (!check.ok) problems.push({ code: check.code, field: "address", detail: check.detail });
  }
  if (input.kycStatus !== undefined && !KYC_STATUSES.includes(input.kycStatus)) problems.push({ code: "kyc_invalid", field: "kycStatus", detail: `KYC status must be one of ${KYC_STATUSES.join(", ")}` });
  if (input.taxFlag !== undefined && !TAX_FLAGS.includes(input.taxFlag)) problems.push({ code: "tax_invalid", field: "taxFlag", detail: `tax flag must be one of ${TAX_FLAGS.join(", ")}` });
  if (input.settlementPref !== undefined && !SETTLEMENT_PREFS.includes(input.settlementPref)) problems.push({ code: "settlement_invalid", field: "settlementPref", detail: `settlement preference must be one of ${SETTLEMENT_PREFS.join(", ")}` });
  if (!isPlainText(input.notes ?? "", 0, 1000)) problems.push({ code: "notes_invalid", field: "notes", detail: "notes must be at most 1000 characters of plain text" });
  return problems;
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
    id: (opts.newId ?? (() => newBatchId(now.getTime())))(),
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
    const others = db.select({ id: recipients.id }).from(recipients).where(and(eq(recipients.orgId, row.orgId), eq(recipients.address, row.address))).all().map((r) => r.id).filter((id) => id !== row.id);
    return toRecord(row, others);
  });
}

/** Every recipient of the org, newest first (UUIDv7 ids sort by time), each with its duplicates. */
export function listRecipients(db: ConsoleDb, orgId: string): Promise<RecipientRecord[]> {
  return runSync(() => {
    const rows = db.select().from(recipients).where(eq(recipients.orgId, orgId)).orderBy(desc(recipients.id)).all();
    const byAddress = new Map<string, string[]>();
    for (const r of rows) byAddress.set(r.address, [...(byAddress.get(r.address) ?? []), r.id]);
    return rows.map((r) => toRecord(r, byAddress.get(r.address)!.filter((id) => id !== r.id)));
  });
}

export function getRecipient(db: ConsoleDb, orgId: string, id: string): Promise<RecipientRecord | undefined> {
  return runSync(() => {
    const r = db.select().from(recipients).where(and(eq(recipients.orgId, orgId), eq(recipients.id, id))).get();
    if (!r) return undefined;
    const others = db.select({ id: recipients.id }).from(recipients).where(and(eq(recipients.orgId, orgId), eq(recipients.address, r.address))).all().map((x) => x.id).filter((x) => x !== id);
    return toRecord(r, others);
  });
}
