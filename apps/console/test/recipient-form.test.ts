// The recipient form's pure pieces (slice H2): read, build the body, and put problems under their fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecipientForm, recipientBody, recipientFormErrors } from "../lib/view/recipient-form.ts";

test("read trims name and address, keeps notes as typed; the body omits empty notes", () => {
  const f = new FormData();
  for (const [k, v] of [["displayName", "  Alice "], ["address", " uregtest1abc "], ["kycStatus", "verified"], ["taxFlag", "non_us"], ["settlementPref", "zec"], ["notes", ""]]) f.set(k, v);
  const v = readRecipientForm(f);
  assert.deepEqual(v, { displayName: "Alice", address: "uregtest1abc", kycStatus: "verified", taxFlag: "non_us", settlementPref: "zec", notes: "" });
  assert.deepEqual(recipientBody(v), { displayName: "Alice", address: "uregtest1abc", kycStatus: "verified", taxFlag: "non_us", settlementPref: "zec" });
  assert.equal(recipientBody({ ...v, notes: "monthly" }).notes, "monthly");
});

test("a 422's problems go under their field; a 400's issues by the path's first segment; the rest at the top", () => {
  assert.deepEqual(recipientFormErrors({ detail: "not created", problems: [{ field: "address", detail: "expected a regtest unified address" }, { field: "displayName", detail: "name must be…" }] }), { top: [], fields: { address: ["expected a regtest unified address"], displayName: ["name must be…"] } });
  assert.deepEqual(recipientFormErrors({ detail: "schema", issues: [{ path: "kycStatus", message: "Invalid option" }, { path: "network", message: "Unrecognized key" }] }), { top: ["Unrecognized key"], fields: { kycStatus: ["Invalid option"] } });
  assert.deepEqual(recipientFormErrors({ detail: "the database is busy; nothing was saved; retry shortly" }), { top: ["the database is busy; nothing was saved; retry shortly"], fields: {} });
});
