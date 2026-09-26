// The zecpay import's preview in words (slice I3b): each row's recipient, the address it will pay, amount and reference;
// refusals by CSV line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { previewRows, refusalLines } from "../lib/view/zecpay-import.ts";

test("existing and new recipients read differently, a differing file name is shown, and each row shows the address it will pay", () => {
  const plan = {
    payables: [
      { sourceLine: 2, address: "a", usdCents: 50000, reference: "SEP-2", recipient: { kind: "existing" as const, id: "r1", name: "Alice Smith", fileName: "A. Smith", address: "stored-a" } },
      { sourceLine: 3, address: "b", usdCents: 22750, reference: "SEP-3", recipient: { kind: "new" as const, name: "Bob", fileName: "Bob" } },
      { sourceLine: 4, address: "b", usdCents: 5, reference: "SEP-4", recipient: { kind: "new" as const, name: "Bob", fileName: "Robert" } },
      { sourceLine: 5, address: "c", usdCents: 1, reference: "SEP-5", recipient: { kind: "existing" as const, id: "r2", name: "Carol", fileName: "Carol", address: "c" } },
    ],
    refused: [{ sourceLine: 6, reason: "the amount is in ZEC" }],
  };
  assert.deepEqual(previewRows(plan), [
    // An existing recipient is paid at its stored address (the file's may differ in case or in its other receivers).
    { sourceLine: 2, recipient: "Alice Smith (existing, matched by Orchard receiver; the file says “A. Smith”)", address: "stored-a", amount: "$500.00", reference: "SEP-2" },
    { sourceLine: 3, recipient: "Bob (new)", address: "b", amount: "$227.50", reference: "SEP-3" },
    { sourceLine: 4, recipient: "Bob (new; the file says “Robert” on this line)", address: "b", amount: "$0.05", reference: "SEP-4" },
    { sourceLine: 5, recipient: "Carol (existing, matched by Orchard receiver)", address: "c", amount: "$0.01", reference: "SEP-5" },
  ]);
  assert.deepEqual(refusalLines(plan), ["CSV line 6 will not be imported: the amount is in ZEC."]);
});
