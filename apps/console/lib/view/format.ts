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
