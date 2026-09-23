// The create-draft form's pure pieces (slice E2b): lines read in order, blank lines skipped with the
// body→line map kept, ZEC converted to zatoshi exactly (never floats), and every API problem placed on the
// form line it belongs to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraftForm, problemsByLine } from "../lib/view/draft-form.ts";

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
  for (const bad of ["", "1,5", "0.123456789", "-1", "1e3", "abc", "21000000.00000001"]) {
    const p = parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: bad, memo: "m" })]));
    assert.equal(p.body, undefined, bad);
    assert.match(p.lineErrors[0][0], /^amount: /, bad);
  }
  const p = parseDraftForm(form([["title", "t"], ...line(0, { payableId: "a", address: "u", amount: "1", memo: "m" }), ...line(1, { payableId: "b", amount: "x" })]));
  assert.deepEqual(Object.keys(p.lineErrors), ["1"]);
});

test("problems land on their form line after skipped blanks; the rest goes to the top", () => {
  const lineMap = [0, 2]; // body item 1 is form line 2
  const r400 = problemsByLine({ issues: [{ path: "items.1.zat", message: "Invalid string" }, { path: "title", message: "Invalid input" }, { path: "items", message: "Too small" }] }, lineMap);
  assert.deepEqual(r400, { top: ["title: Invalid input", "items: Too small"], lines: { 2: ["zat: Invalid string"] } });
  const r422 = problemsByLine(
    { problems: [{ code: "memo_duplicate", index: 1, detail: 'memo "A" appears twice' }, { code: "title_invalid", detail: "title must be 1–200 characters of plain text" }, { code: "x", index: 0, detail: "bad address" }] },
    lineMap,
  );
  assert.deepEqual(r422, { top: ["title must be 1–200 characters of plain text"], lines: { 2: ['memo "A" appears twice'], 0: ["bad address"] } });
  assert.deepEqual(problemsByLine({ detail: "the console has not finished starting" }, []), { top: ["the console has not finished starting"], lines: {} });
});
