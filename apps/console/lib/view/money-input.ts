// A US dollar amount typed by a person, to whole cents exactly (slice H4; R79). GOV.UK's guidance: a text input with
// `inputmode="decimal"` (never type="number"), a currency prefix, and no restriction on usual formatting such as
// thousands commas. The conversion is decimal arithmetic on the digits, never `Number` (ZBooks' `Number(amount)`).
// Only what is not a dollar amount is refused here; zero and the cap are the API's rule (H3 `usd_invalid`).

import { USD_CENTS_MAX } from "../data/payable-rules.ts";

// "$" optional; digits plain or grouped by commas in threes; a point and 1–2 digits optional.
const DOLLARS = /^\$?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/** Whole cents, or undefined when `text` is not a dollar amount. Amounts past the cap return `USD_CENTS_MAX + 1`. */
export function dollarsToCents(text: string): number | undefined {
  const m = DOLLARS.exec(text.trim());
  if (!m) return undefined;
  const cents = BigInt(m[1].replaceAll(",", "")) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  // Past the cap the exact value does not matter (the API refuses it); a bounded number keeps it safe to send.
  return cents > BigInt(USD_CENTS_MAX) ? USD_CENTS_MAX + 1 : Number(cents);
}
