// Exact conversions between integer zatoshi and 8-decimal ZEC strings. No floating point.

export const ZAT_PER_ZEC = 100_000_000n;
/** 21,000,000 ZEC: an upper bound for any single amount. */
export const MAX_ZAT = 21_000_000n * ZAT_PER_ZEC;

export function zatToDecimal(zat: bigint): string {
  if (zat < 0n) throw new RangeError(`negative amount ${zat}`);
  if (zat > MAX_ZAT) throw new RangeError(`amount ${zat} exceeds 21M ZEC`);
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

export function decimalToZat(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s.trim());
  if (!m) throw new RangeError(`not a non-negative decimal with at most 8 places: ${JSON.stringify(s)}`);
  const zat = BigInt(m[1]) * ZAT_PER_ZEC + BigInt((m[2] ?? "").padEnd(8, "0"));
  if (zat > MAX_ZAT) throw new RangeError(`amount ${s} exceeds 21M ZEC`);
  return zat;
}

/** Like decimalToZat but accepts a leading minus (Zkool reports sent value negative). */
export function signedDecimalToZat(s: string): bigint {
  const t = s.trim();
  return t.startsWith("-") ? -decimalToZat(t.slice(1)) : decimalToZat(t);
}
