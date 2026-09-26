// The Konclave import (slice I2; REQ-CON-19; `05` §3.6). The first tests are Konclave's own CSV tests
// (deegalabs/konclave `orchestrator/src/payroll.rs` at 1a8216c, R112), ported with the console's two stated
// differences: a header is only the column names, and an empty memo needs the operator's prefix. Addresses are not
// checked here: the draft form checks them when the draft is created (its placeholder `u1alice` would be refused there).

import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPORT_MAX_ROWS, konclaveZecToZat, parseKonclaveCsv } from "../lib/import/konclave.ts";

const withPrefix = { memoPrefix: "PAY-09" };

test("Konclave's imports_csv_with_header_and_reports_bad_rows: three lines, Carol refused at source line 4", () => {
  const csv = "label,address,value,memo\nAlice,u1alice,0.5,ref maio\nBob,u1bob,0.25,\nCarol,u1carol,oops,bad amount\n,u1dave,0.1,no label ok\n";
  const r = parseKonclaveCsv(csv, withPrefix);
  assert.deepEqual(r.lines.map((l) => [l.sourceLine, l.label, l.amount, l.memo]), [
    [2, "Alice", "0.5", "ref maio"],
    [3, "Bob", "0.25", "PAY-09-3"],
    [5, "", "0.1", "no label ok"],
  ]);
  assert.deepEqual(r.refused, [{ sourceLine: 4, reason: "invalid amount 'oops'" }]);
  assert.deepEqual(r.madeMemos, [{ sourceLine: 3, memo: "PAY-09-3" }], "Bob had no memo: the prefix made one, and says so");
  assert.deepEqual(r.lines.map((l) => l.payableId), ["row-2", "row-3", "row-5"]);
});

test("Konclave's header_is_optional: two data rows and no header", () => {
  const r = parseKonclaveCsv("Alice,u1alice,0.5,\nBob,u1bob,0.25,", withPrefix);
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.refused, []);
});

test("Konclave's memo_may_contain_commas: the memo is everything after the third comma", () => {
  const r = parseKonclaveCsv("Alice,u1alice,0.5,salary for May, thanks!", withPrefix);
  assert.equal(r.lines[0].memo, "salary for May, thanks!");
});

test("Konclave's zero_and_empty_address_rejected: both refused, by source line", () => {
  const r = parseKonclaveCsv("A,u1a,0,\nB,,0.5,", withPrefix);
  assert.deepEqual(r.refused, [
    { sourceLine: 1, reason: "amount must be greater than zero" },
    { sourceLine: 2, reason: "empty address" },
  ]);
  assert.equal(r.lines.length, 0);
});

test("unlike Konclave, a mistyped first amount is refused, not dropped as a header", () => {
  const r = parseKonclaveCsv("Alice,u1alice,0,5,May\nBob,u1bob,0.25,June", withPrefix);
  // Konclave's rule would drop line 1 without a word: its third field (split on every comma) is "0", a valid amount,
  // so here it is kept as a zero amount and refused; and "1 ZEC" is refused as an invalid amount.
  assert.deepEqual(r.refused, [{ sourceLine: 1, reason: "amount must be greater than zero" }]);
  const s = parseKonclaveCsv("Alice,u1alice,1 ZEC,May\nBob,u1bob,0.25,June", withPrefix);
  assert.deepEqual(s.refused, [{ sourceLine: 1, reason: "invalid amount '1 ZEC'" }]);
  assert.deepEqual(s.lines.map((l) => l.sourceLine), [2]);
});

test("a header is only the column names, in any case, with or without memo", () => {
  for (const header of ["label,address,value", "LABEL, Address ,Value,memo"]) {
    const r = parseKonclaveCsv(`${header}\nA,u1a,1,m`, withPrefix);
    assert.deepEqual([r.lines.length, r.refused.length], [1, 0], header);
  }
  const r = parseKonclaveCsv("name,wallet,amount\nA,u1a,1,m", withPrefix);
  assert.deepEqual(r.refused, [{ sourceLine: 1, reason: "invalid amount 'amount'" }], "another format's header is reported, not skipped");
});

test("amounts follow Konclave's from_zec_str: digits and one point, .5 and 5. allowed, no sign, at most 8 decimals", () => {
  const cases: [string, bigint | undefined][] = [
    ["0.5", 50_000_000n], [".5", 50_000_000n], ["5.", 500_000_000n], [" 1 ", 100_000_000n], ["0.00000001", 1n],
    ["0.000000001", undefined], ["-1", undefined], ["+1", undefined], ["1,000", undefined], ["1e3", undefined], [".", undefined], ["", undefined],
  ];
  for (const [field, want] of cases) assert.equal(konclaveZecToZat(field), want, JSON.stringify(field));
  const r = parseKonclaveCsv("A,u1a,.5,m\nB,u1b,5.,n", withPrefix);
  assert.deepEqual(r.lines.map((l) => l.amount), ["0.5", "5"], "written as the draft form's amount field accepts");
});

test("an empty memo without a prefix is refused; blank lines are skipped but still counted", () => {
  const r = parseKonclaveCsv("\nA,u1a,1,\n\nB,u1b,2,memo", { memoPrefix: "  " });
  assert.deepEqual(r.refused, [{ sourceLine: 2, reason: "no memo, and no memo prefix was given for rows without one" }]);
  assert.deepEqual(r.lines.map((l) => l.sourceLine), [4]);
  assert.deepEqual(r.madeMemos, []);
});

test("CRLF files parse the same; too few columns is refused", () => {
  const r = parseKonclaveCsv("A,u1a,1,m\r\nB,u1b\r\n", withPrefix);
  assert.deepEqual(r.lines.map((l) => l.memo), ["m"]);
  assert.deepEqual(r.refused, [{ sourceLine: 2, reason: "expected columns: label,address,value[,memo]" }]);
});

test(`at most ${IMPORT_MAX_ROWS} lines: the rest are refused by source line`, () => {
  const csv = Array.from({ length: IMPORT_MAX_ROWS + 2 }, (_, i) => `P${i},u1p${i},1,M-${i}`).join("\n");
  const r = parseKonclaveCsv(csv, withPrefix);
  assert.equal(r.lines.length, IMPORT_MAX_ROWS);
  assert.deepEqual(r.refused, [
    { sourceLine: 51, reason: `a batch holds at most ${IMPORT_MAX_ROWS} lines` },
    { sourceLine: 52, reason: `a batch holds at most ${IMPORT_MAX_ROWS} lines` },
  ]);
});
