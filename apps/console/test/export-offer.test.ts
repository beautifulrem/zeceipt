// What the batch page offers for the OpenZcash export (slice X2c): the four cases, decided from the receipts alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_DISCLOSURE, exportOffer } from "../lib/view/export-offer.ts";

const ID = "0192f0e2-0000-7000-8000-000000000000";
const ok = { openError: undefined };

test("no receipts: nothing is offered", () => {
  assert.deepEqual(exportOffer(ID, [], 3), { kind: "none" });
});

test("a receipt that does not open: a note instead of the link (the route would answer 409)", () => {
  const o = exportOffer(ID, [ok, { openError: "unknown_key" }, ok], 3);
  assert.deepEqual(o, { kind: "unopenable", text: "A receipt of this batch does not open, so the OpenZcash file cannot be made." });
});

test("every line has a receipt: the link, all lines with our three extra columns named, and the disclosure", () => {
  assert.deepEqual(exportOffer(ID, [ok, ok, ok], 3), {
    kind: "offer",
    href: `/api/batches/${ID}/exports/openzcash`,
    scope: "All 3 lines, in OpenZcash's own export columns, plus the txid, receipt link and rate.",
    disclosure: EXPORT_DISCLOSURE,
  });
});

test("some lines without receipts: k of N, and only those are in the file", () => {
  const o = exportOffer(ID, [ok, ok], 5);
  assert.equal(o.kind, "offer");
  assert.equal(o.kind === "offer" && o.scope, "2 of 5 lines have receipts, and only those are in the file.");
});

test("the disclosure says the file holds every link, that it cannot be taken back, and that publishing publishes", () => {
  assert.match(EXPORT_DISCLOSURE, /every receipt link/);
  assert.match(EXPORT_DISCLOSURE, /cannot be taken back/);
  assert.match(EXPORT_DISCLOSURE, /publishing the file in a ledger publishes them/);
});
