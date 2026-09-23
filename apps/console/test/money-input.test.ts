// Dollars to cents (slice H4; R79): exact decimal arithmetic on what a person types, never Number().
import { test } from "node:test";
import assert from "node:assert/strict";
import { dollarsToCents } from "../lib/view/money-input.ts";
import { USD_CENTS_MAX } from "../lib/data/payables.ts";

test("accepted: plain or comma-grouped dollars, an optional $, up to 2 decimals, surrounding spaces", () => {
  for (const [text, cents] of [
    ["1234.56", 123456], ["1,234.56", 123456], ["$1,234.56", 123456], ["0.5", 50], ["12", 1200], ["0.01", 1], [" 7.10 ", 710],
    ["999,999.99", 99_999_999], ["1,000,000", 100_000_000], ["0", 0], ["0.00", 0], ["0.1", 10], ["$0.07", 7],
  ] as const) assert.equal(dollarsToCents(text), cents, text);
});

test("exact where floats are not: 0.29 dollars is 29 cents (0.29 * 100 = 28.999999999999996 in binary)", () => {
  assert.equal(0.29 * 100 === 29, false, "the float trap this avoids");
  assert.equal(dollarsToCents("0.29"), 29);
  assert.equal(dollarsToCents("12,345.67"), 1_234_567);
  assert.equal(dollarsToCents("4.35"), 435, "4.35 * 100 = 434.99999999999994 in binary");
});

test("refused: anything that is not a dollar amount", () => {
  for (const text of ["", " ", "abc", "1.234", "1,23", "12,345,67", "1,2345", ",123", "-5", "+5", "1e3", "$", "1.", ".5", "1 000", "$ 5", "5$", "US$5", "5 USD", "١٢٣", "0x10", "Infinity", "NaN"]) {
    assert.equal(dollarsToCents(text), undefined, JSON.stringify(text));
  }
});

test("past the cap: one over the cap, never an unsafe number (the API gives the message)", () => {
  assert.equal(dollarsToCents("1,000,000.00"), USD_CENTS_MAX + 1);
  assert.equal(dollarsToCents("9".repeat(40)), USD_CENTS_MAX + 1);
  assert.ok(Number.isSafeInteger(dollarsToCents("9".repeat(40))!));
});
