// US cents to zatoshi at a locked rate (slice H5a; 05 `batch_items`): zat = floor(usd_cents × 10^8 / (100 × rate)),
// exact. The rate is the lock's plain decimal string (the bid, G1a), I.F = R / 10^d, so
// zat = floor(cents × 10^(6+d) / R) in BigInt: no binary floats anywhere. A floor, so the payer never overpays by
// rounding (05); the recipient gets at most 1 zatoshi less than the exact value (the "dust", derived, never stored).

const RATE = /^(\d{1,15})(?:\.(\d{1,18}))?$/;

function scaled(rate: string): { r: bigint; d: bigint } {
  const m = RATE.exec(rate);
  if (!m) throw new RangeError("rate is not a plain decimal");
  const r = BigInt(m[1] + (m[2] ?? ""));
  if (r === 0n) throw new RangeError("rate is zero");
  return { r, d: BigInt((m[2] ?? "").length) };
}

function checkCents(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`not a whole, non-negative number of cents: ${cents}`);
  return BigInt(cents);
}

/** floor(cents × 10^8 / (100 × rate)) zatoshi. */
export function usdCentsToZat(cents: number, rate: string): bigint {
  const { r, d } = scaled(rate);
  return (checkCents(cents) * 10n ** (6n + d)) / r;
}

/** What the floor dropped, exact − zat, as a fraction of one zatoshi: [numerator, denominator), numerator < denominator. */
export function dustZat(cents: number, rate: string): { numerator: bigint; denominator: bigint } {
  const { r, d } = scaled(rate);
  return { numerator: (checkCents(cents) * 10n ** (6n + d)) % r, denominator: r };
}
