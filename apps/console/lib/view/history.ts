// The batch history in words (slice I4): one sentence per audit event. The detail's values are our own records, still
// checked, so a malformed value falls back to a plainer sentence rather than printing "undefined".

import type { AuditEvent } from "../data/audit.ts";
import { rateText } from "./format.ts";

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** One sentence for an event; events recorded by the migration's backfill say so. */
export function eventText(e: Pick<AuditEvent, "action" | "detail">): string {
  const d = e.detail;
  const n = int(d.attempts);
  const attempt = n ? `Payment attempt ${n}` : "A payment attempt";
  let text: string;
  switch (e.action) {
    case "created":
      text = str(d.title) ? `Created as “${str(d.title)}”` : "Created";
      break;
    case "locked":
      text = str(d.rate) ? `Rate locked at ${rateText(str(d.rate)!)}${int(d.seq) ? ` (lock ${int(d.seq)})` : ""}` : "Rate locked";
      break;
    case "quoted":
      text = str(d.rate) ? `Rate checked before paying: ${rateText(str(d.rate)!)}` : "Rate checked before paying";
      break;
    case "approved":
      text = int(d.lockSeq) ? `Approved at lock ${int(d.lockSeq)}` : "Approved";
      break;
    case "attempt_submitting":
      text = `${attempt} started`;
      break;
    case "attempt_broadcast":
      text = str(d.txid) ? `${attempt} broadcast as ${str(d.txid)}` : `${attempt} broadcast`;
      break;
    case "attempt_failed_retryable":
      text = `${attempt} sent nothing${str(d.error) ? `: ${str(d.error)}` : ""}`;
      break;
    case "attempt_unknown_outcome":
      text = `${attempt}: the outcome is unknown${str(d.error) ? ` (${str(d.error)})` : ""}; it may have paid`;
      break;
    case "expiry_recorded":
      text = int(d.expiresBy) ? `Expiry bound recorded: block ${int(d.expiresBy)}` : "Expiry bound recorded";
      break;
    case "voided":
      text = "Voided: this batch can never be paid";
      break;
    case "receipt_issued":
      text = int(d.idx) !== undefined ? `Receipt issued for line ${int(d.idx)! + 1}` : "Receipt issued";
      break;
    case "exported": {
      const rows = int(d.rows);
      const what = d.format === "openzcash" ? "OpenZcash CSV" : "CSV";
      text = rows !== undefined ? `Exported as ${what} (${rows} ${rows === 1 ? "receipt link" : "receipt links"})` : `Exported as ${what}`;
      break;
    }
    default:
      text = e.action;
  }
  return d.backfilled === true ? `${text} (recorded before the history existed)` : text;
}
