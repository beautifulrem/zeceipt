// The OpenZcash-compatible export (REQ-INT-2; `05` §3.1; slice X2a). OpenZcash's own "Export CSV" writes its table's
// rendered cells; these functions reproduce its formatters, field quoting, formula guard and file layout, read from
// the JavaScript openzcash.org serves (R110), so a row from the console sits beside a row exported from openzcash.org
// in one spreadsheet. Pure: no I/O. The data query and the route are slice X2b.

/** OpenZcash's mark for an empty cell. */
export const EMPTY = "·";

/** The ten columns of `05` §3.1: OpenZcash's seven, in its order, then ours. */
export const OPENZCASH_HEADER = ["Recipient", "Detail", "Category", "USD", "ZEC", "Date", "Status", "Txid", "Receipt", "Rate"] as const;

const USD_WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const USD_CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** OpenZcash's `formatUsdCents` (non-compact): `$12,000` for whole dollars, `$227.50` otherwise, `·` for none. */
export function formatUsdCents(cents: number | null): string {
  if (cents === null) return EMPTY;
  const dollars = cents / 100;
  return (Number.isInteger(dollars) ? USD_WHOLE : USD_CENTS).format(dollars);
}

/** OpenZcash's `formatZec` without the symbol: the whole part comma-grouped, the fraction without trailing zeros. */
export function formatZec(zat: bigint): string {
  const negative = zat < 0n;
  const abs = negative ? -zat : zat;
  const whole = (abs / 100000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

// OpenZcash's guard, verbatim: a field that a spreadsheet could read as a formula gets a leading `'`, unless it is a
// number in this pattern (a sign, `$`, commas, a fraction, a short unit), which it leaves alone.
const FORMULA_START = /^\s*[=+@\-\t\r]/;
const NUMBER_LIKE = /^\s*[-−]?\$?\d[\d,]*(\.\d+)?(\s*[A-Za-z%]{1,4})?\s*$/;

/** One CSV field as OpenZcash writes it: guarded, then quoted with `"` doubled. */
export function csvField(value: string): string {
  const guarded = !NUMBER_LIKE.test(value) && FORMULA_START.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** The whole file as OpenZcash's `downloadTableCsv` builds it: a BOM, then CRLF-separated lines, no final newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return "\uFEFF" + [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

/** What one exported row needs: an issued receipt's line and the facts around it. */
export type ExportLine = {
  recipientName: string;
  /** The line's memo (`batch_items.memo`), which is the payable's reference for a line made from a payable. */
  memo: string;
  /** The payable's kind, or null for a line made on the form. */
  kind: "milestone" | "invoice" | "bounty" | "salary" | null;
  /** The line's US cents, or null for a line made on the form. */
  usdCents: number | null;
  zat: bigint;
  /** The submission's `broadcast_at` (ISO), or null if none was recorded. */
  broadcastAt: string | null;
  txid: string;
  receiptUrl: string;
  /** The batch's locked rate for a batch made from payables, or null for a batch made on the form. */
  rate: string | null;
};

const KIND_LABEL = { milestone: "Milestone", invoice: "Invoice", bounty: "Bounty", salary: "Salary" } as const;

/** OpenZcash's per-cell clean-up, verbatim: its table applies `.replace(/\s+/g, " ").trim()` to each rendered cell. */
export function cleanCell(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The ten cells of `05` §3.1 for one line, before quoting. */
export function openZcashRow(line: ExportLine): string[] {
  // Each of OpenZcash's seven cells in its renderer's order: the renderer's `·` for an empty value first, then the
  // clean-up (so a whitespace-only memo gives an empty cell, as OpenZcash's `detail || "·"` does; review X2a round 2).
  // Recipient is the exception: OpenZcash's cell is never empty (it carries the row type and origin), so the `·` after
  // cleaning is the console's own choice, for an empty or blank label.
  const openZcashColumns = [
    cleanCell(line.recipientName) || EMPTY,
    cleanCell(line.memo || EMPTY),
    cleanCell(line.kind ? KIND_LABEL[line.kind] : EMPTY),
    cleanCell(formatUsdCents(line.usdCents)),
    cleanCell(formatZec(line.zat)),
    cleanCell(line.broadcastAt ? new Date(line.broadcastAt).toISOString().slice(0, 10) : EMPTY),
    cleanCell("Completed"),
  ];
  return [...openZcashColumns, line.txid, line.receiptUrl, line.rate ?? EMPTY];
}
