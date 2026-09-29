// The batch list's stage (slice F4): from the console's records, never claiming confirmation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { batchStage } from "../lib/view/stage.ts";

test("stage: voided first, then receipts (all or some), then sent, else draft; never 'confirmed'", () => {
  const f = { voided: false, submitted: false, receipts: 0, items: 3 };
  assert.deepEqual(batchStage(f), { label: "Draft", tone: "neutral" });
  assert.deepEqual(batchStage({ ...f, submitted: true }), { label: "Sent, awaiting receipts", tone: "warning" });
  assert.deepEqual(batchStage({ ...f, submitted: true, receipts: 3 }), { label: "Receipts issued", tone: "success" });
  assert.deepEqual(batchStage({ ...f, submitted: true, receipts: 1 }), { label: "Receipts 1 of 3", tone: "warning" });
  assert.deepEqual(batchStage({ ...f, voided: true }), { label: "Voided", tone: "neutral" });
  for (const s of [f, { ...f, submitted: true }, { ...f, receipts: 3 }]) assert.ok(!/confirm/i.test(batchStage(s).label));
});
