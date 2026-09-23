// The payable form's pure pieces (slice H4): reading, the body, and where each API problem is shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { payableBody, payableFormErrors, readPayableForm, REFERENCE_TAKEN } from "../lib/view/payable-form.ts";

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

test("an amount that is not dollars is the form's own error; the API is not called", () => {
  const r = payableBody({ recipientId: "r1", kind: "invoice", amount: "12.345", reference: "X", sourceUrl: "" });
  assert.ok("amountError" in r && /at most 2 decimal places/.test(r.amountError));
});

test("errors: 422 by field (usdCents shown on the amount), 409 on the reference, 400 by path, the rest on top", () => {
  assert.deepEqual(payableFormErrors({ code: "payable_invalid", detail: "d", problems: [{ field: "usdCents", detail: "cents" }, { field: "reference", detail: "ref" }, { field: "recipientId", detail: "who" }, { field: "sourceUrl", detail: "link" }, { detail: "no field" }] }),
    { top: ["no field"], fields: { amount: ["cents"], reference: ["ref"], recipientId: ["who"], sourceUrl: ["link"] } });
  assert.deepEqual(payableFormErrors({ code: "reference_taken", detail: "another payable…", payableId: "p1" } as never), { top: [], fields: { reference: [REFERENCE_TAKEN] } });
  assert.deepEqual(payableFormErrors({ code: "body_invalid", detail: "d", issues: [{ path: "kind", message: "bad kind" }, { path: "", message: "unknown key" }] }), { top: ["unknown key"], fields: { kind: ["bad kind"] } });
  assert.deepEqual(payableFormErrors({ code: "store_busy", detail: "busy; retry" }), { top: ["busy; retry"], fields: {} });
});
