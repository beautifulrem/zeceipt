// The OpenZcash-compatible export (slice X2a; REQ-INT-2; `05` §3.1). Every expected string below was produced by
// OpenZcash's own functions (`formatUsdCents`, `formatZec`, the field function of `downloadTableCsv`), extracted from the
// JavaScript openzcash.org served on 2026-09-26 (R110) and run in Node; the script and its output are kept with the
// slice (`.trellis/tasks/09-26-openzcash-csv-writer/`), the third-party file itself is not committed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvField, formatUsdCents, formatZec, OPENZCASH_HEADER, openZcashRow, toCsv, type ExportLine } from "../lib/index.ts";

test("USD cells equal OpenZcash's formatUsdCents: no decimals for whole dollars, two otherwise, · for none", () => {
  const table: [number | null, string][] = [
    [1200000, "$12,000"],
    [22750, "$227.50"],
    [5, "$0.05"],
    [100, "$1"],
    [45000, "$450"],
    [99999999, "$999,999.99"],
    [null, "·"],
  ];
  for (const [cents, want] of table) assert.equal(formatUsdCents(cents), want, `${cents}`);
});

test("ZEC cells equal OpenZcash's formatZec without the symbol: grouped, trailing zeros removed", () => {
  const table: [bigint, string][] = [
    [14648356n, "0.14648356"],
    [123450000000n, "1,234.5"],
    [100000000n, "1"],
    [2100000000000000n, "21,000,000"],
    [1n, "0.00000001"],
    [776000000n, "7.76"],
    [82566679n, "0.82566679"],
  ];
  for (const [zat, want] of table) assert.equal(formatZec(zat), want, `${zat}`);
});

test("fields are quoted as OpenZcash quotes them, with its formula guard (leading space counts; numbers are exempt)", () => {
  const table: [string, string][] = [
    ["plain", '"plain"'],
    ['say "hi"', '"say ""hi"""'],
    ["=SUM(A1)", `"'=SUM(A1)"`],
    ["  -x", `"'  -x"`],
    ["+1", `"'+1"`], // OpenZcash's number pattern allows no plus sign, so this is guarded
    ["@x", `"'@x"`],
    ["\tx", `"'\tx"`],
    ["-$1,200", '"-$1,200"'],
    ["-0.5 ZEC", '"-0.5 ZEC"'],
    ["−3", '"−3"'], // U+2212 minus
    ["·", '"·"'],
    ["$227.50", '"$227.50"'],
  ];
  for (const [value, want] of table) assert.equal(csvField(value), want, JSON.stringify(value));
});

test("the file is byte-equal to the golden file built with OpenZcash's own field function", () => {
  const tx = "5ae051e6c6939dd2e8d7964cdff0b9d5f500dd188e74148484bee0b272ca5d9d";
  const lines: ExportLine[] = [
    { recipientName: "Ana Souza", memo: "BOUNTY-101", kind: "bounty", usdCents: 22750, zat: 14648356n, broadcastAt: "2026-09-25T23:10:00.000Z", txid: tx, receiptUrl: "https://pay.example.org/r#AAAA", rate: "1553.29000" },
    { recipientName: 'Ben "Kay" Lee', memo: '=HYPERLINK("x")', kind: null, usdCents: null, zat: 100000000n, broadcastAt: "2026-09-26T00:00:00.000Z", txid: tx, receiptUrl: "https://pay.example.org/r#BBBB", rate: null },
    { recipientName: "  -Dee", memo: "M-7 · grant", kind: "milestone", usdCents: 1200000, zat: 2100000000000000n, broadcastAt: null, txid: tx, receiptUrl: "https://pay.example.org/r#CCCC", rate: "1553.29000" },
  ];
  const golden = readFileSync(new URL("./fixtures/openzcash-golden.csv", import.meta.url), "utf8");
  const file = toCsv(OPENZCASH_HEADER, lines.map(openZcashRow));
  assert.equal(file, golden);
  assert.ok(file.startsWith("\uFEFF\"Recipient\""), "a BOM, then the header");
  assert.equal(file.split("\r\n").length, 4, "CRLF between lines, none at the end");
});

test("Date is the UTC day of the broadcast, whatever the offset it was written with", () => {
  const base: ExportLine = { recipientName: "A", memo: "M", kind: null, usdCents: null, zat: 1n, broadcastAt: null, txid: "0".repeat(64), receiptUrl: "https://h/r#x", rate: null };
  assert.equal(openZcashRow({ ...base, broadcastAt: "2026-09-25T23:59:59-07:00" })[5], "2026-09-26");
  assert.equal(openZcashRow({ ...base, broadcastAt: "2026-09-26T00:00:00.000Z" })[5], "2026-09-26");
  assert.equal(openZcashRow(base)[5], "·");
});

test("the header is OpenZcash's seven columns in its order, then ours", () => {
  assert.deepEqual([...OPENZCASH_HEADER], ["Recipient", "Detail", "Category", "USD", "ZEC", "Date", "Status", "Txid", "Receipt", "Rate"]);
});
