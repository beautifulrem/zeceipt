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

/** "$1,234.56": whole cents as US dollars, by integer arithmetic (slice H4), so every amount up to the cap is exact. */
export function centsText(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`not a whole, non-negative number of cents: ${cents}`);
  const dollars = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * A recipient named so two can be told apart (review H4): display names need not be unique (H1 flags addresses, not
 * names), so the name goes with the address's ZIP 316 prefix, "Alice · uregtest1qzj498rks3e6gfazv0fxns3d0…".
 */
export function recipientLabel(name: string, address: string): string {
  return `${name} · ${shortAddress(address)}`;
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

/** Each source's own host: only a quote from it is named as that source (slice N1). */
const SOURCE_HOSTS: Record<string, string> = { kraken: "api.kraken.com" };

/**
 * Where a quote came from, truthfully (slice N1; review L2): the source's name only when the quote came from its own
 * host; "Kraken-format quote from 127.0.0.1:5555" for a proxy, a mirror or a test double; and "(host not recorded)"
 * for quotes recorded before hosts were (migration 0024), rather than a guess.
 */
export function sourceLabel(source: string, host: string | undefined): string {
  const name = sourceName(source);
  if (host === undefined) return `${name} format (host not recorded)`;
  return host === SOURCE_HOSTS[source] ? name : `${name}-format quote from ${host}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An id for a table (slice M1b): a UUID by its last 12 characters, "…b8fd8d637cd9", and any other id whole. UUIDv7's
 * head is a millisecond timestamp (RFC 9562 §5.7), shared by ids made together; the final group is random, so it tells
 * them apart. The whole id stays one click away where it is shown (`Identifier`).
 */
export function abridgeId(id: string): { short: string; whole: string } {
  return UUID.test(id) ? { short: `…${id.slice(-12)}`, whole: id } : { short: id, whole: id };
}
