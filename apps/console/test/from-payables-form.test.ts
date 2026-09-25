// The "batch from payables" form's pure pieces (slice H5b): reading, and where each API problem is shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTER_TITLE, fromPayablesFormErrors, readFromPayablesForm, SOURCE_DOWN, STORE_BUSY } from "../lib/view/from-payables-form.ts";

test("read: the title trimmed; the checked ids in document order; none checked is an empty list", () => {
  const f = new FormData();
  f.set("title", "  September  ");
  for (const id of ["p3", "p1", ""]) f.append("payableIds", id);
  assert.deepEqual(readFromPayablesForm(f), { title: "September", payableIds: ["p3", "p1"] });
  assert.deepEqual(readFromPayablesForm(new FormData()), { title: "", payableIds: [] });
});

test("errors: an index finds the payable posted there; the title and the choice have their own places; the rest on top", () => {
  const posted = ["p3", "p1", "p9"];
  assert.deepEqual(fromPayablesFormErrors({ code: "batch_invalid", detail: "d", problems: [
    { code: "payable_taken", index: 2, detail: "already in batch B" },
    { code: "amount_out_of_range", index: 0, detail: "too small" },
    { code: "title_invalid", detail: "title must be…" },
    { code: "empty_batch", detail: "choose at least one payable" },
    { code: "something_else", detail: "other" },
  ] }, posted, { p9: "REF-9" }), { top: ["REF-9: already in batch B. It is no longer offered.", "other"], title: [ENTER_TITLE], choice: ["choose at least one payable"], byPayable: { p3: ["too small"] } });
  assert.deepEqual(fromPayablesFormErrors({ code: "body_invalid", detail: "d", issues: [{ path: "payableIds", message: "Too big" }, { path: "title", message: "Required" }, { path: "", message: "unknown key" }] }, []), { top: ["unknown key"], title: ["Required"], choice: ["Too big"], byPayable: {} });
});

test("review H5b: a payable taken or gone since the page loaded is not offered again, so its problem is at the top, naming it", () => {
  const posted = ["p1", "p2", "p3"];
  const out = fromPayablesFormErrors({ code: "batch_invalid", detail: "d", problems: [
    { code: "payable_taken", index: 0, detail: "this payable is already in batch B" },
    { code: "payable_unknown", index: 1, detail: "no payable with this id in this organisation" },
    { code: "amount_out_of_range", index: 2, detail: "too small" },
  ] }, posted, { p1: "CH-1", p3: "CH-3" });
  assert.deepEqual(out.top, ["CH-1: this payable is already in batch B. It is no longer offered.", "A chosen payable no longer exists, so it is no longer offered."]);
  assert.deepEqual(out.byPayable, { p3: ["too small"] }, "a free payable's problem stays under its box");
});

test("the rate source and a busy store are said in words at the top, and say that nothing was made", () => {
  assert.deepEqual(fromPayablesFormErrors({ code: "rate_unavailable", detail: "the source…" }, ["p1"]).top, [SOURCE_DOWN]);
  assert.deepEqual(fromPayablesFormErrors({ code: "store_busy", detail: "busy" }, ["p1"]).top, [STORE_BUSY]);
  assert.match(SOURCE_DOWN, /nothing was made/);
});
