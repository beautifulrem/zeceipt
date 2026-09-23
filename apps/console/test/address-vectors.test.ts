// Unified address decoding (review H1) against the official zcash-test-vectors, and malformed addresses built
// with a small ZIP 316 encoder here (items → HRP padding → F4Jumble → Bech32m) so each rule is exercised alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkUnifiedAddress, TYPECODE } from "../lib/execution/address.ts";
import { f4jumble, f4jumbleInv } from "../lib/execution/f4jumble.ts";

const FIX = join(import.meta.dirname, "fixtures");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("F4Jumble matches all 8 official vectors, both directions (48 to 16449 bytes)", () => {
  const v = JSON.parse(readFileSync(join(FIX, "zcash-test-vectors-f4jumble.json"), "utf8")).slice(2) as [string, string][];
  assert.equal(v.length, 8);
  for (const [normal, jumbled] of v) {
    assert.equal(hex(f4jumble(Buffer.from(normal, "hex"))), jumbled);
    assert.equal(hex(f4jumbleInv(Buffer.from(jumbled, "hex"))), normal);
  }
  assert.throws(() => f4jumbleInv(new Uint8Array(47)), RangeError, "below ZIP 316's minimum");
});

test("all 60 official unified addresses decode to exactly their receivers; those without Orchard are refused as such", () => {
  const rows = JSON.parse(readFileSync(join(FIX, "zcash-test-vectors-unified_address.json"), "utf8")) as (string | number | null)[][];
  const cols = String(rows[1][0]).split(", ");
  const vectors = rows.slice(2).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) as Record<string, string | null>[];
  assert.equal(vectors.length, 60);
  let withOrchard = 0;
  for (const v of vectors) {
    const got = checkUnifiedAddress(v.unified_addr!, "main");
    const expected: [number, string][] = [];
    if (v.p2pkh_bytes) expected.push([TYPECODE.p2pkh, v.p2pkh_bytes]);
    if (v.p2sh_bytes) expected.push([TYPECODE.p2sh, v.p2sh_bytes]);
    if (v.sapling_raw_addr) expected.push([TYPECODE.sapling, v.sapling_raw_addr]);
    if (v.orchard_raw_addr) expected.push([TYPECODE.orchard, v.orchard_raw_addr]);
    if (v.unknown_typecode !== null && v.unknown_typecode !== undefined) expected.push([Number(v.unknown_typecode), v.unknown_bytes!]);
    expected.sort((a, b) => a[0] - b[0]);
    if (v.orchard_raw_addr) {
      withOrchard++;
      assert.ok(got.ok, `${v.unified_addr!.slice(0, 20)}…: ${!got.ok && got.detail}`);
      assert.deepEqual(got.receivers.map((r) => [r.typecode, hex(r.data)]), expected);
    } else {
      assert.deepEqual(got.ok ? "ok" : got.code, "address_no_orchard", v.unified_addr!.slice(0, 20));
    }
  }
  assert.ok(withOrchard > 10 && withOrchard < 60, `the vectors cover both cases (${withOrchard} with Orchard)`);
});

import { item, ua } from "./helpers/ua-encoder.ts";

const code = (a: string) => {
  const r = checkUnifiedAddress(a, "regtest");
  return r.ok ? "ok" : r.code;
};

test("the encoder here round-trips: an Orchard-only address built with it is accepted", () => {
  const good = ua("uregtest", [item(3, 43)]);
  const r = checkUnifiedAddress(good, "regtest");
  assert.ok(r.ok && r.receivers.length === 1 && r.receivers[0].typecode === 3);
});

test("strings that pass the checksum but are not unified addresses are refused (review H1)", () => {
  assert.equal(code("uregtest1qpzry9x8gf2t736tzy"), "address_malformed", "the reviewer's 27-character probe");
  assert.equal(code(ua("uregtest", [item(0, 20)])), "address_malformed", "transparent only (38 bytes: below the minimum)");
  assert.match((checkUnifiedAddress(ua("uregtest", [item(0, 20)]), "regtest") as { detail: string }).detail, /the payload is 38 bytes/);
  assert.equal(code(ua("uregtest", [item(0, 20), item(1, 20), item(3, 43)])), "address_malformed", "both transparent kinds");
  assert.equal(code(ua("uregtest", [item(3, 43)], "u")), "address_malformed", "padding of another prefix");
  assert.equal(code(ua("uregtest", [item(3, 42)])), "address_malformed", "an Orchard receiver of the wrong length");
  assert.equal(code(ua("uregtest", [item(3, 43), item(2, 43)])), "address_malformed", "typecodes out of order");
  assert.equal(code(ua("uregtest", [item(3, 43), item(3, 43, 9)])), "address_malformed", "a duplicate typecode");
  assert.equal(code(ua("uregtest", [[0xfd, 0x03, 0x00, 43, ...new Array(43).fill(7)]])), "address_malformed", "a non-canonical CompactSize typecode");
  assert.equal(code(ua("uregtest", [item(2, 43)])), "address_no_orchard", "Sapling only: a valid address this console cannot pay");
  assert.equal(code(ua("uregtest", [item(3, 43), item(0x10, 5)])), "ok", "an unknown typecode after Orchard is allowed (ZIP 316)");
});
