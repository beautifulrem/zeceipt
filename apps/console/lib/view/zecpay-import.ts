// The zecpay import's preview in words (slice I3b; REQ-CON-19; `05` §3.6): each accepted row as the payable it would
// be, each refusal by its CSV line, and the state the page's form carries between Preview and Import.

import type { ZecpayPlan } from "../import/zecpay.ts";
import { centsText } from "./format.ts";

export interface PreviewRow {
  sourceLine: number;
  recipient: string;
  /** The address the payable will pay: the existing recipient's as stored, or the new recipient's from the file. */
  address: string;
  amount: string;
  reference: string;
}

export interface ZecpayImportState {
  submission: number;
  csv: string;
  kind: string;
  prefix: string;
  /** Set after a preview; Import sends it back so the write is the plan shown. */
  fingerprint?: string;
  rows: PreviewRow[];
  refused: string[];
  /** A file-level problem or an outcome message (nothing written). */
  message?: string;
  /** What an import wrote (review I3b round 1: carried in the action's state, not in a link anyone could send). */
  notice?: string;
}

/** How a planned row's recipient reads: the existing one (and the file's name when it differs), or a new one. */
export function previewRows(plan: ZecpayPlan): PreviewRow[] {
  return plan.payables.map((p) => {
    const r = p.recipient;
    const who =
      r.kind === "existing"
        ? `${r.name} (existing, matched by Orchard receiver${r.fileName && r.fileName !== r.name ? `; the file says “${r.fileName}”` : ""})`
        : `${r.name} (new${r.fileName !== r.name ? `; the file says “${r.fileName}” on this line` : ""})`;
    return { sourceLine: p.sourceLine, recipient: who, address: r.kind === "existing" ? r.address : p.address, amount: centsText(p.usdCents), reference: p.reference };
  });
}

export function refusalLines(plan: ZecpayPlan): string[] {
  return plan.refused.map((r) => `CSV line ${r.sourceLine} will not be imported: ${r.reason}.`);
}
