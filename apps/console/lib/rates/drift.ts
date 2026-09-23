// How far the market moved between a batch's lock and the execution quote (slice G2a; REQ-CON-21, R74).
// Decided exactly: both rates are scaled to the same number of decimals as bigints, and
//   moved  ⇔  |execution − lock| × 10 000  >  maxBps × lock
// so a move of exactly the threshold is allowed and anything beyond it is refused, with no float rounding.
// The move is also reported in basis points for display, floored to 0.01 bp (never rounded up to a refusal).

import { DECIMAL, isPositiveDecimal } from "./decimal.ts";

export interface Drift {
  /** True when the move is strictly larger than the threshold. */
  moved: boolean;
  /** |execution − lock| / lock in basis points, floored to two decimals ("312.50"). */
  bps: string;
  direction: "up" | "down" | "flat";
}

/** REQ-CON-21: a move of more than 3% between the lock and the execution quote blocks execution. */
export const DEFAULT_MAX_DRIFT_BPS = 300;

const places = (s: string) => (s.split(".")[1] ?? "").length;
function scaled(s: string, p: number): bigint {
  const [int, frac = ""] = s.split(".");
  return BigInt(int + frac.padEnd(p, "0"));
}

export function rateDrift(lock: string, execution: string, maxBps: number): Drift {
  if (!isPositiveDecimal(lock) || !isPositiveDecimal(execution) || !DECIMAL.test(lock) || !DECIMAL.test(execution)) {
    throw new RangeError("rates must be positive plain decimals");
  }
  if (!Number.isInteger(maxBps) || maxBps < 1 || maxBps > 2000) throw new RangeError("maxBps must be an integer from 1 to 2000");
  const p = Math.max(places(lock), places(execution));
  const l = scaled(lock, p);
  const e = scaled(execution, p);
  const diff = e > l ? e - l : l - e;
  const hundredths = (diff * 1_000_000n) / l; // basis points × 100, floored
  return {
    moved: diff * 10_000n > BigInt(maxBps) * l,
    bps: `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`,
    direction: e > l ? "up" : e < l ? "down" : "flat",
  };
}

/** "3.00%" from basis points given as a decimal string or a number ("312.50" → "3.12%"; floored to 0.01%). */
export function pctFromBps(bps: string | number): string {
  const [whole, frac = ""] = String(bps).split(".");
  const hundredths = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2)); // hundredths of a bp
  return `${hundredths / 10_000n}.${((hundredths % 10_000n) / 100n).toString().padStart(2, "0")}%`;
}

/**
 * The move for a rate_moved refusal, shared by the API and the page (slices G2b1, G2b2; here beside the drift, so http and view import the same words). The drift is floored
 * for display (G2a), so a refused move just past the limit can floor to the limit itself: then say "more than"
 * the limit rather than a figure equal to it (review G2a).
 */
export function movedText(bps: string, maxBps: number): string {
  const [whole, frac = ""] = bps.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return hundredths <= BigInt(maxBps) * 100n ? `more than ${pctFromBps(maxBps)}` : pctFromBps(bps);
}
