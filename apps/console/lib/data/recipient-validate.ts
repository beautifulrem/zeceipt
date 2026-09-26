// The recipient value rules (slices H1 and H7; REQ-CON-2), without the database, so a pure module (the zecpay import
// planner, slice I3a) can use them and cannot reach a write: `lib/data/recipients.ts` imports the database and
// re-exports these (review I3a round 1).

import { checkUnifiedAddress } from "../execution/address.ts";
import type { Network } from "../execution/types.ts";
import { hasInvisible, isPlainText } from "./text.ts";

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

export type RecipientProblemCode = "name_invalid" | "address_hrp" | "address_checksum" | "address_malformed" | "address_no_orchard" | "address_case" | "kyc_invalid" | "tax_invalid" | "settlement_invalid" | "notes_invalid";
export interface RecipientProblem {
  code: RecipientProblemCode;
  field: "displayName" | "address" | "kycStatus" | "taxFlag" | "settlementPref" | "notes";
  detail: string;
}

/**
 * Bech32m is case-insensitive only in a single case: an all-upper-case address (as QR codes carry it) is the same
 * address lowercased; mixed case is not an address.
 */
/** A unified address in one case, lower-cased (Bech32 allows all upper case); undefined when it mixes cases. */
export function canonicalAddress(a: string): string | undefined {
  if (a === a.toLowerCase()) return a;
  if (a === a.toUpperCase()) return a.toLowerCase();
  return undefined;
}

export function recipientProblems(input: RecipientInput): RecipientProblem[] {
  const problems: RecipientProblem[] = [];
  if (!isPlainText(input.displayName, 1, 200) || input.displayName.trim() === "") problems.push({ code: "name_invalid", field: "displayName", detail: "display name must be 1–200 characters of plain text, not only spaces" });
  // Slice H7: a name that renders differently from what it holds could pass for another (R78); other spaces are fine
  // in a name, which is a label, not a key (H4 tells two "Alice"s apart by address).
  else if (hasInvisible(input.displayName)) problems.push({ code: "name_invalid", field: "displayName", detail: "display name must not contain invisible characters (zero-width characters, bidirectional controls, soft hyphens, variation selectors, control characters)" });
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

