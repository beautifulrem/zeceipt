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
