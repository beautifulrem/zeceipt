// US cents to zatoshi at a locked rate (slice H5a): exact, floored, and shown back as the same dollars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dustZat, usdCentsToZat } from "../lib/rates/convert.ts";
import { usdText } from "../lib/view/format.ts";

test("hand-computed values: zat = floor(cents × 10^8 / (100 × rate))", () => {
  // $1,600.00 at 1600.00 USD/ZEC is exactly 1 ZEC.
  assert.equal(usdCentsToZat(160_000, "1600.00"), 100_000_000n);
  // $25.00 at 31.41592 USD/ZEC: 2500 × 10^11 / 3141592 = 79577488.7… → 79577488 (checked with Python's Fraction).
  assert.equal(usdCentsToZat(2_500, "31.41592"), 79_577_488n);
  // $0.29 at 1 USD/ZEC is 0.29 ZEC (0.29 × 100 is 28.999999999999996 as a float).
  assert.equal(usdCentsToZat(29, "1"), 29_000_000n);
  // The largest payable, $999,999.99 at 42.5: 99999999 × 10^7 / 425 = 2352941152941.17… → 2352941152941.
  assert.equal(usdCentsToZat(99_999_999, "42.5"), 2_352_941_152_941n);
  // A rate so high that one cent is under a zatoshi: 1 × 10^6 / 2000000 → 0 (the batch rules refuse it).
  assert.equal(usdCentsToZat(1, "2000000"), 0n);
  // A rate so low that a payable exceeds the supply: 99999999 × 10^6 × 10^8 / 1 → far over 2.1e15.
  assert.ok(usdCentsToZat(99_999_999, "0.00000001") > 2_100_000_000_000_000n);
});

test("dust: what the floor dropped, below one zatoshi, and exact − zat reconstructs the value", () => {
  const { numerator, denominator } = dustZat(2_500, "31.41592");
  assert.ok(numerator < denominator);
  assert.equal((usdCentsToZat(2_500, "31.41592") * denominator + numerator), 2_500n * 10n ** 11n, "zat × R + dust = cents × 10^(6+d)");
  assert.deepEqual(dustZat(160_000, "1600.00"), { numerator: 0n, denominator: 160_000n }, "exact: no dust");
});

test("shown back at the lock, the converted line is the payable's dollars, for every rate below $500,000/ZEC", () => {
  // The floor loses under 1 zatoshi = rate × 10^-6 cents; below $500,000 that is under half a cent, so rounding
  // half up restores the cents. Checked over awkward amounts and rates.
  const dollars = (c: number) => `$${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
  for (const rate of ["0.01", "1", "31.41592", "1600.00", "1612.34567", "99999.99", "499999.99"]) {
    for (const cents of [1, 29, 99, 12_345, 1_000_000, 99_999_999]) {
      const zat = usdCentsToZat(cents, rate);
      if (zat < 1n || zat > 2_100_000_000_000_000n) continue; // outside a payable line (refused by the batch rules)
      assert.equal(usdText(zat, rate), dollars(cents), `${cents}¢ at ${rate}`);
    }
  }
  // Above $500,000 the lost fraction can reach half a cent, and a line may show one cent less (values from Python's
  // Fraction): 8¢ at $900,000 is 8 zat (8.88…), worth 7.2¢, shown "$0.07".
  assert.equal(usdCentsToZat(8, "900000"), 8n);
  assert.equal(usdText(8n, "900000"), "$0.07");
});

test("refuses what is not cents or not a rate", () => {
  for (const [c, r] of [[-1, "1"], [1.5, "1"], [Number.NaN, "1"], [1, "0"], [1, "0.000"], [1, "1e3"], [1, "-5"], [1, ""]] as const) assert.throws(() => usdCentsToZat(c, r), RangeError, `${c} at ${r}`);
});
