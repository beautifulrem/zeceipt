// Display formatting for the console pages (slice E1). Exact: bigint arithmetic, never floats.

const ZAT_PER_ZEC = 100_000_000n;

/**
 * "1.01 ZEC" from zatoshi, exact and without a range cap: a 50-item batch total can reach 1.05e17 zat,
 * beyond `zatToDecimal`'s 21M-ZEC guard (which is right for a single payment, not for a display sum).
 */
export function zecText(zat: bigint): string {
  if (zat < 0n) throw new RangeError("negative amount");
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} ZEC`;
}

/** "uregtest1qzj4…u4w": enough to recognise an address; the full one goes in `title`. */
export function shortAddress(address: string): string {
  return address.length <= 24 ? address : `${address.slice(0, 14)}…${address.slice(-6)}`;
}

/**
 * "$1,616.24": the USD value of `zat` at `rate` (USD per ZEC, a plain decimal string), for display beside an
 * amount (slice G1c2). Exact to the cent: value = zat × rate / 10^8, computed with bigints and rounded half
 * up to cents only at the end. A display figure, not a conversion: converting USD to ZEC (G3) floors in zat.
 */
export function usdText(zat: bigint, rate: string): string {
  if (zat < 0n) throw new RangeError("negative amount");
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(rate);
  if (!m) throw new RangeError("rate is not a plain decimal");
  const frac = m[2] ?? "";
  const scaledRate = BigInt(m[1] + frac); // rate × 10^frac.length
  const denominator = ZAT_PER_ZEC * 10n ** BigInt(frac.length); // value in USD = zat × scaledRate / denominator
  const cents = (zat * scaledRate * 100n * 2n + denominator) / (denominator * 2n); // round half up
  const dollars = cents / 100n;
  return `$${dollars.toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** "1 ZEC = $1,616.24": the rate itself, to the cent (the exact string is shown beside it). */
export function rateText(rate: string): string {
  return `1 ZEC = ${usdText(ZAT_PER_ZEC, rate)}`;
}
