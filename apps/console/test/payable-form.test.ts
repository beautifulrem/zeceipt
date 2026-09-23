// The payable form's pure pieces (slice H4): reading, the body, and where each API problem is shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHOOSE_RECIPIENT, payableBody, payableFormErrors, readPayableForm, REFERENCE_TAKEN } from "../lib/view/payable-form.ts";
import { recipientLabel } from "../lib/view/format.ts";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

test("read and build: reference and link trimmed, the amount converted exactly, an empty link omitted", () => {
  const v = readPayableForm(form({ recipientId: "r1", kind: "bounty", amount: "$1,234.56", reference: "  BOUNTY-7 ", sourceUrl: "  " }));
  assert.deepEqual(v, { recipientId: "r1", kind: "bounty", amount: "$1,234.56", reference: "BOUNTY-7", sourceUrl: "" });
  assert.deepEqual(payableBody(v), { body: { recipientId: "r1", kind: "bounty", usdCents: 123456, reference: "BOUNTY-7" } });
  assert.deepEqual(payableBody({ ...v, sourceUrl: "https://x.example/7" }), { body: { recipientId: "r1", kind: "bounty", usdCents: 123456, reference: "BOUNTY-7", sourceUrl: "https://x.example/7" } });
  assert.deepEqual(readPayableForm(new FormData()), { recipientId: "", kind: "", amount: "", reference: "", sourceUrl: "" }, "missing fields read as empty");
});

test("the form's own errors, together, before the API: an amount that is not dollars, and no recipient chosen (review H4)", () => {
  const r = payableBody({ recipientId: "r1", kind: "invoice", amount: "12.345", reference: "X", sourceUrl: "" });
  assert.ok("fields" in r && /at most 2 decimal places/.test(r.fields.amount![0]) && !r.fields.recipientId);
  const none = payableBody({ recipientId: "", kind: "invoice", amount: "5", reference: "X", sourceUrl: "" });
  assert.deepEqual(none, { fields: { recipientId: [CHOOSE_RECIPIENT] } });
  const both = payableBody({ recipientId: "", kind: "invoice", amount: "", reference: "X", sourceUrl: "" });
  assert.ok("fields" in both && both.fields.recipientId && both.fields.amount, "both listed at once");
});

test("two recipients with one name are told apart by the address's ZIP 316 prefix (review H4)", () => {
  const a = recipientLabel("Alice", "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w");
  const b = recipientLabel("Alice", "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj");
  assert.equal(a, "Alice · uregtest1qzj498rks3e6gfazv0fxns3d0…");
  assert.notEqual(a, b);
});

test("errors: 422 by field (usdCents shown on the amount), 409 on the reference, 400 by path, the rest on top", () => {
  assert.deepEqual(payableFormErrors({ code: "payable_invalid", detail: "d", problems: [{ field: "usdCents", detail: "cents" }, { field: "reference", detail: "ref" }, { field: "recipientId", detail: "who" }, { field: "sourceUrl", detail: "link" }, { detail: "no field" }] }),
    { top: ["no field"], fields: { amount: ["cents"], reference: ["ref"], recipientId: ["who"], sourceUrl: ["link"] } });
  assert.deepEqual(payableFormErrors({ code: "reference_taken", detail: "another payable…", payableId: "p1" } as never), { top: [], fields: { reference: [REFERENCE_TAKEN] } });
  assert.deepEqual(payableFormErrors({ code: "body_invalid", detail: "d", issues: [{ path: "kind", message: "bad kind" }, { path: "", message: "unknown key" }] }), { top: ["unknown key"], fields: { kind: ["bad kind"] } });
  assert.deepEqual(payableFormErrors({ code: "store_busy", detail: "busy; retry" }), { top: ["busy; retry"], fields: {} });
});
