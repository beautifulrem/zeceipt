// The zecpay import's preview in words (slice I3b): each row's recipient, amount and reference; refusals by CSV line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { previewRows, refusalLines } from "../lib/view/zecpay-import.ts";

test("existing and new recipients read differently, and a differing file name is shown", () => {
  const plan = {
    payables: [
      { sourceLine: 2, address: "a", usdCents: 50000, reference: "SEP-2", recipient: { kind: "existing" as const, id: "r1", name: "Alice Smith", fileName: "A. Smith" } },
      { sourceLine: 3, address: "b", usdCents: 22750, reference: "SEP-3", recipient: { kind: "new" as const, name: "Bob", fileName: "Bob" } },
      { sourceLine: 4, address: "b", usdCents: 5, reference: "SEP-4", recipient: { kind: "new" as const, name: "Bob", fileName: "Robert" } },
      { sourceLine: 5, address: "c", usdCents: 1, reference: "SEP-5", recipient: { kind: "existing" as const, id: "r2", name: "Carol", fileName: "Carol" } },
    ],
    refused: [{ sourceLine: 6, reason: "the amount is in ZEC" }],
  };
  assert.deepEqual(previewRows(plan), [
    { sourceLine: 2, recipient: "Alice Smith (existing; the file says “A. Smith”)", amount: "$500.00", reference: "SEP-2" },
    { sourceLine: 3, recipient: "Bob (new)", amount: "$227.50", reference: "SEP-3" },
    { sourceLine: 4, recipient: "Bob (new; the file says “Robert” on this line)", amount: "$0.05", reference: "SEP-4" },
    { sourceLine: 5, recipient: "Carol (existing)", amount: "$0.01", reference: "SEP-5" },
  ]);
  assert.deepEqual(refusalLines(plan), ["CSV line 6 will not be imported: the amount is in ZEC."]);
});
