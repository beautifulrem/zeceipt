// What the batch page offers for the OpenZcash export (slice X2c; REQ-INT-2; `05` §3.1), decided from the batch's
// receipts and its line count: nothing without receipts; a note instead of a link when a receipt does not open (the
// route would answer 409); otherwise the link, what the file holds (all lines, or k of N), and what it discloses.

export type ExportOffer =
  | { kind: "none" }
  | { kind: "unopenable"; text: string }
  | { kind: "offer"; href: string; scope: string; disclosure: string };

export const EXPORT_DISCLOSURE =
  "The file holds every receipt link above. Whoever gets it can see each of these payments, and that cannot be taken back: publishing the file in a ledger publishes them.";

export function exportOffer(batchId: string, receipts: readonly { openError?: string }[], lineCount: number): ExportOffer {
  if (receipts.length === 0) return { kind: "none" };
  if (receipts.some((r) => r.openError)) return { kind: "unopenable", text: "A receipt of this batch does not open, so the OpenZcash file cannot be made." };
  const scope =
    receipts.length < lineCount
      ? `${receipts.length} of ${lineCount} lines have receipts, and only those are in the file.`
      : `All ${receipts.length} lines, in OpenZcash's own export columns, plus the txid, receipt link and rate.`;
  return { kind: "offer", href: `/api/batches/${batchId}/exports/openzcash`, scope, disclosure: EXPORT_DISCLOSURE };
}
