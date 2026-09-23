// Exact decimal strings for prices (slice G1a). A price is kept as the text the source sent and compared
// with scaled integers, never binary floats (zecpay's `usd / rate` in floats is the anti-pattern, R46).

/** A non-negative decimal: digits, optionally a point and more digits. No sign, exponent, spaces or separators. */
export const DECIMAL = /^\d{1,15}(\.\d{1,18})?$/;

function scaled(s: string, places: number): bigint {
  const [int, frac = ""] = s.split(".");
  return BigInt(int + frac.padEnd(places, "0"));
}

const places = (s: string) => (s.split(".")[1] ?? "").length;

/** A well-formed decimal greater than zero. */
export function isPositiveDecimal(s: string): boolean {
  return DECIMAL.test(s) && scaled(s, places(s)) > 0n;
}

/** Exact comparison of two well-formed decimals: -1, 0 or 1. Throws on malformed input. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) throw new Error("compareDecimal: not a decimal");
  const p = Math.max(places(a), places(b));
  const x = scaled(a, p);
  const y = scaled(b, p);
  return x < y ? -1 : x > y ? 1 : 0;
}
