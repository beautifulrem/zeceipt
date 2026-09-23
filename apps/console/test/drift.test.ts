// Rate drift (slice G2a; REQ-CON-21): exact at the threshold, both directions, beyond float precision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_DRIFT_BPS, rateDrift } from "../lib/index.ts";

test("the threshold is inclusive: exactly 3% passes, anything beyond is refused, both directions", () => {
  assert.equal(DEFAULT_MAX_DRIFT_BPS, 300);
  assert.deepEqual(rateDrift("1000", "1030", 300), { moved: false, bps: "300.00", direction: "up" });
  assert.deepEqual(rateDrift("1000", "970", 300), { moved: false, bps: "300.00", direction: "down" });
  assert.deepEqual(rateDrift("1000", "1030.00000001", 300), { moved: true, bps: "300.00", direction: "up" }, "one hundred-millionth beyond: refused, though the display floors to 300.00");
  assert.deepEqual(rateDrift("1000", "969.99999999", 300), { moved: true, bps: "300.00", direction: "down" });
  assert.deepEqual(rateDrift("1610.95000", "1610.95", 300), { moved: false, bps: "0.00", direction: "flat" });
});

test("real rates: small moves pass, a 5% move is refused; the display is floored", () => {
  const small = rateDrift("1610.95000", "1614.21000", 300); // +0.2023…%
  assert.deepEqual([small.moved, small.bps, small.direction], [false, "20.23", "up"]);
  const big = rateDrift("1600.00", "1680.00", 300);
  assert.deepEqual([big.moved, big.bps], [true, "500.00"]);
  // A tighter threshold (Stripe's transfers: 1%, R74) refuses what 3% allows.
  assert.equal(rateDrift("1600", "1617", 100).moved, true);
  assert.equal(rateDrift("1600", "1617", 300).moved, false);
});

test("exact beyond float precision: 18 decimals decide correctly where floats would not", () => {
  // 0.1 + 0.2 style: lock 0.3, exactly 3% up is 0.309; one unit in the 18th place beyond is refused.
  assert.equal(rateDrift("0.3", "0.309", 300).moved, false);
  assert.equal(rateDrift("0.3", "0.309000000000000001", 300).moved, true);
  assert.equal(rateDrift("0.300000000000000000", "0.309", 300).moved, false, "trailing zeros change nothing");
});

test("bad input is refused, never guessed", () => {
  for (const [l, e] of [["0", "1"], ["1", "0"], ["-1", "1"], ["1e3", "1000"], ["", "1"]]) assert.throws(() => rateDrift(l, e, 300), RangeError, `${l} → ${e}`);
  for (const bps of [0, -1, 2001, 1.5, Number.NaN]) assert.throws(() => rateDrift("1", "1", bps), RangeError, String(bps));
});

test("the refusal's wording never shows a figure equal to the limit, at the resolution it prints (review G2b2)", async () => {
  const { movedText, pctFromBps } = await import("../lib/index.ts");
  assert.equal(pctFromBps("312.5"), "3.12%");
  assert.equal(pctFromBps(300), "3.00%");
  assert.equal(pctFromBps("0.99"), "0.00%");
  for (const bps of ["300.00", "300.50", "300.62", "300.99"]) assert.equal(movedText(bps, 300), "more than 3.00%", bps);
  assert.equal(movedText("301.00", 300), "3.01%");
  assert.equal(movedText("500.00", 300), "5.00%");
  // Real quotes: 1000.00 → 1030.05 and 1600.00 → 1648.10 / 1551.90 are refused and must not read "moved 3.00%".
  for (const [l, e] of [["1000.00", "1030.05"], ["1600.00", "1648.10"], ["1600.00", "1551.90"]]) {
    const d = rateDrift(l, e, 300);
    assert.equal(d.moved, true, `${l} → ${e}`);
    assert.equal(movedText(d.bps, 300), "more than 3.00%", `${l} → ${e} (${d.bps} bp)`);
  }
});
