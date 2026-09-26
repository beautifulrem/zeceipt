// The create-draft form's pure pieces (slice E2b): lines read in order, blank lines skipped with the
// body→line map kept, ZEC converted to zatoshi exactly (never floats), and every API problem placed on the
// form line it belongs to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addLine, editableLines, parseDraftForm, problemsByLine, removeLine, updateLine, BLANK_LINE, mergeImported } from "../lib/view/draft-form.ts";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const line = (n: number, l: Partial<Record<"payableId" | "label" | "address" | "amount" | "memo", string>>) =>
  (["payableId", "label", "address", "amount", "memo"] as const).map((k) => [`lines.${n}.${k}`, l[k] ?? ""] as [string, string]);

test("lines: blank ones skipped, the map keeps form positions, ZEC becomes exact zatoshi", () => {
  const p = parseDraftForm(
    form([
      ["title", " October "],
      ...line(0, { payableId: "a", address: "u1", amount: "0.25", memo: "A" }),
      ...line(1, {}),
      ...line(2, { payableId: "b", label: " Bob ", address: " u2 ", amount: "0.1", memo: "B" }),
      ["$ACTION_KEY", "ignored"],
      ["lines.x.amount", "ignored"],
    ]),
  );
  assert.deepEqual(p.lineMap, [0, 2]);
  assert.deepEqual(p.lineErrors, {});
  assert.deepEqual(p.body, {
    title: "October",
    items: [
      { payableId: "a", address: "u1", zat: "25000000", memo: "A" },
      { payableId: "b", label: "Bob", address: "u2", zat: "10000000", memo: "B" },
    ],
  });
  assert.equal(p.lines.length, 3, "every form line is kept for re-rendering");
  // Eight places stay exact (Number("0.30000001") * 1e8 is 30000000.999999996 in floating point).
  assert.equal(parseDraftForm(form([...line(0, { amount: "0.30000001", payableId: "x", address: "u", memo: "m" })])).body!.items[0].zat, "30000001");
});

test("amounts: a malformed amount is an error on its line and nothing is sent", () => {
  for (const bad of ["", "1,5", "0.123456789", "-1", "1e3", "abc"]) {
    const p = parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: bad, memo: "m" })]));
    assert.equal(p.body, undefined, bad);
    assert.equal(p.lineErrors[0][0], "amount: a ZEC amount with at most 8 decimal places, like 0.25", bad);
  }
  // Above the supply is said as such, not as a decimal-places problem (review E2b round 1).
  assert.deepEqual(parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: "21000000.00000001", memo: "m" })])).lineErrors, { 0: ["amount: more than 21 million ZEC"] });
  const p = parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: "1", memo: "m" }), ...line(1, { payableId: "b", amount: "x" })]));
  assert.deepEqual(Object.keys(p.lineErrors), ["1"]);
});

test("problems land on their form line after skipped blanks; the rest goes to the top", () => {
  const lineMap = [0, 2]; // body item 1 is form line 2
  const r400 = problemsByLine({ issues: [{ path: "items.1.zat", message: "Invalid string" }, { path: "title", message: "Invalid input" }, { path: "items", message: "Too small" }] }, lineMap);
  assert.deepEqual(r400, { top: ["title: Invalid input", "items: Too small"], lines: { 2: ["amount: Invalid string"] } }, "the API's zat is the form's amount");
  const r422 = problemsByLine(
    { problems: [{ code: "memo_duplicate", index: 1, detail: 'memo "A" appears twice' }, { code: "title_invalid", detail: "title must be 1–200 characters of plain text" }, { code: "x", index: 0, detail: "bad address" }] },
    lineMap,
  );
  assert.deepEqual(r422, { top: ["title must be 1–200 characters of plain text"], lines: { 2: ['memo "A" appears twice'], 0: ["bad address"] } });
  assert.deepEqual(problemsByLine({ detail: "the console has not finished starting" }, []), { top: ["the console has not finished starting"], lines: {} });
});

test("form-level limits in the form's words, before the API is called: no lines, more than 50", () => {
  const none = parseDraftForm(form([["title", "t"], ...line(0, {}), ...line(1, {})]));
  assert.deepEqual([none.body, none.top], [undefined, ["Add at least one line."]]);
  const many = parseDraftForm(form([["title", "t"], ...Array.from({ length: 51 }, (_, i) => line(i, { payableId: `p${i}`, address: "u", amount: "1", memo: `m${i}` })).flat()]));
  assert.deepEqual([many.body, many.top], [undefined, ["At most 50 lines per batch."]]);
  assert.deepEqual(parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: "1", memo: "m" })])).top, []);
});

test("editing lines: remove takes the line clicked (with its values and errors), never the last; ids stay unique", () => {
  const A = { ...BLANK_LINE, payableId: "A-1", label: "Alice", amount: "1.1" };
  const B = { ...BLANK_LINE, payableId: "B-1", label: "Bob", amount: "2.2" };
  const C = { ...BLANK_LINE, payableId: "C-1", label: "Carol", amount: "3.3" };
  const lines = editableLines([A, B, C], { 1: ["memo: required"] });
  const afterRemove = removeLine(lines, lines[0].id); // remove Alice (the reviewer's reproduction)
  assert.deepEqual(afterRemove.map((l) => l.values.label), ["Bob", "Carol"]);
  assert.deepEqual(afterRemove.map((l) => l.errors), [["memo: required"], []], "Bob's error stays with Bob");
  const added = addLine(afterRemove);
  assert.equal(new Set(added.map((l) => l.id)).size, 3, "a new line gets a fresh id");
  const edited = updateLine(added, added[2].id, "amount", "0.5");
  assert.deepEqual(edited.map((l) => l.values.amount), ["2.2", "3.3", "0.5"]);
  assert.equal(removeLine(edited, 999).length, 3, "an unknown id removes nothing");
});

test("an import is merged after the lines already typed; the limit counts both; every note names its CSV line (slice I2)", () => {
  const typed = [{ ...BLANK_LINE, payableId: "p1", address: "u1a", amount: "1", memo: "M1" }, { ...BLANK_LINE }];
  const imported = {
    lines: [
      { sourceLine: 2, payableId: "row-2", label: "Alice", address: "u1b", amount: "0.5", memo: "A" },
      { sourceLine: 3, payableId: "row-3", label: "Bob", address: "u1c", amount: "0.25", memo: "PAY-3" },
    ],
    refused: [{ sourceLine: 4, reason: "invalid amount 'oops'" }],
    madeMemos: [{ sourceLine: 3, memo: "PAY-3" }],
  };
  const out = mergeImported(typed, imported, 50);
  assert.deepEqual(out.lines.map((l) => l.payableId), ["p1", "row-2", "row-3"], "the blank typed line is dropped; the typed one stays first");
  assert.deepEqual(out.notes, [
    "Added 2 lines from the CSV; review them, then create the draft.",
    "CSV line 3: it had no memo, so it was given PAY-3.",
    "CSV line 4 was not added: invalid amount 'oops'.",
  ]);
  const full = mergeImported(typed, imported, 2);
  assert.deepEqual(full.lines.map((l) => l.payableId), ["p1", "row-2"]);
  assert.deepEqual(full.notes, [
    "Added 1 line from the CSV; review them, then create the draft.",
    "CSV line 3 was not added: a batch holds at most 2 lines.",
    "CSV line 4 was not added: invalid amount 'oops'.",
  ], "a made memo on a row that did not fit is not mentioned");
  assert.deepEqual(mergeImported([{ ...BLANK_LINE }], { lines: [], refused: [], madeMemos: [] }, 50).lines, [{ ...BLANK_LINE }], "never an empty form");
});
