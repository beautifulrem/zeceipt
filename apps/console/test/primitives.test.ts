import { test } from "node:test";
import assert from "node:assert/strict";
import { bech32mCheck, checkUnifiedAddress, decimalToZat, estimateIronwoodFeeZat, zatToDecimal, batchDigest } from "../lib/index.ts";

// Real regtest unified addresses produced by Zkool (PROOF §5b).
const R1 = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const R2 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";

test("money: exact round trips, no floats", () => {
  assert.equal(zatToDecimal(101_000_000n), "1.01000000");
  assert.equal(zatToDecimal(1n), "0.00000001");
  assert.equal(decimalToZat("1.01"), 101_000_000n);
  assert.equal(decimalToZat("217.25048750"), 21_725_048_750n);
  assert.equal(decimalToZat("0.1") + decimalToZat("0.2"), decimalToZat("0.3"));
  for (const bad of ["-1", "1.123456789", "1e8", "", "21000000.00000001"]) assert.throws(() => decimalToZat(bad), RangeError, bad);
  assert.throws(() => zatToDecimal(-1n), RangeError);
});

test("address: regtest UA passes; wrong network, typo, case and truncation fail", () => {
  assert.deepEqual(checkUnifiedAddress(R1, "regtest"), { ok: true, hrp: "uregtest" });
  assert.equal(checkUnifiedAddress(R1, "main").ok, false);
  const typo = R1.slice(0, 40) + (R1[40] === "q" ? "p" : "q") + R1.slice(41);
  assert.deepEqual(checkUnifiedAddress(typo, "regtest"), { ok: false, code: "address_checksum", detail: "Bech32m checksum does not verify (typo or truncated address)" });
  assert.equal(checkUnifiedAddress(R1.toUpperCase(), "regtest").ok, false);
  assert.equal(checkUnifiedAddress(R1.slice(0, -1), "regtest").ok, false);
  assert.equal(checkUnifiedAddress("tmGys6dBuEGjch5LFnhdo5gpSa7jiNRWse6", "regtest").ok, false);
  // BIP-350 Bech32m test vector (short form) — the checksum implementation is the standard one.
  assert.deepEqual(bech32mCheck("a1lqfn3a"), { hrp: "a" });
  assert.equal(bech32mCheck("a1lqfn3b"), null);
});

test("fee: ZIP 317 estimate for n recipients + change", () => {
  assert.equal(estimateIronwoodFeeZat(1), 10_000n); // grace actions
  assert.equal(estimateIronwoodFeeZat(3), 20_000n); // measured fee of the 3-recipient Zkool tx (PROOF §5b)
});

test("batch digest: order- and value-sensitive, network-bound", () => {
  const b = { id: "b", network: "regtest" as const, items: [
    { payableId: "p1", address: R1, zat: 1n, memo: "A" },
    { payableId: "p2", address: R2, zat: 2n, memo: "B" },
  ] };
  const d = batchDigest(b);
  assert.equal(d, batchDigest(structuredClone(b)));
  assert.notEqual(d, batchDigest({ ...b, network: "test" }));
  assert.notEqual(d, batchDigest({ ...b, items: [b.items[1], b.items[0]] }));
  assert.notEqual(d, batchDigest({ ...b, items: [{ ...b.items[0], zat: 3n }, b.items[1]] }));
});
