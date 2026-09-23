// Display formatting for the console pages (slice E1). Exact: bigint arithmetic, never floats.

const ZAT_PER_ZEC = 100_000_000n;

/**
 * "1.01000000 ZEC" from zatoshi: always 8 decimals (04 principle 4; slice G1d), as Zkool, the wallet this
 * console pays through, shows every amount (R73). Exact, and without a range cap: a 50-item batch total can
 * reach 1.05e17 zat, beyond `zatToDecimal`'s 21M-ZEC guard (right for one payment, not for a display sum).
 */
export function zecText(zat: bigint): string {
  if (zat < 0n) throw new RangeError("negative amount");
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, "0");
  return `${whole.toLocaleString("en-US")}.${frac} ZEC`;
}

/**
 * `zecText` split for display, as Zkool's `zatToText` does: `major` runs to the third decimal, `minor` holds the
 * last five decimals, which the page shows lighter. `major + minor + " ZEC"` is always `zecText(zat)`.
 */
export function zecParts(zat: bigint): { major: string; minor: string } {
  const number = zecText(zat).slice(0, -" ZEC".length);
  return { major: number.slice(0, -5), minor: number.slice(-5) };
}

/** Data characters kept after the separator: 25 × 5 bits = 125 bits, Zcash's classical security target (ZIP 316). */
export const SHORT_ADDRESS_DATA_CHARS = 25;

/**
 * An address abridged for a table: a prefix only, "u1qzj498rks3e6gfazv0fxns3d0v4…". ZIP 316: an abridged UA "MUST"
 * show at least its first 20 characters (an "absolute minimum" against lookalike addresses), and a prefix is
 * preferred, since only initial characters are comparable across wallets. We keep the prefix, the "1" separator and
 * 25 data characters, which reaches the 2^125 target the rationale names (review H2: `slice(0, 14)` showed only 5
 * data characters of a regtest UA). Bech32's data part cannot contain "1", so the last "1" is the separator.
 */
export function shortAddress(address: string): string {
  const keep = address.lastIndexOf("1") + 1 + SHORT_ADDRESS_DATA_CHARS;
  return address.length <= keep + 1 ? address : `${address.slice(0, keep)}…`;
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

/** A rate source as people name it: the recorded `source` id, never a hard-coded name (review G1c2). */
export function sourceName(source: string): string {
  return ({ kraken: "Kraken" } as Record<string, string>)[source] ?? source;
}
