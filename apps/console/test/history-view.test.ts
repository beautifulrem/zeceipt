// The batch history in words (slice I4; design I4.4.3): one sentence per action, a backfilled event says so, and a
// malformed detail falls back to a plain sentence rather than "undefined".

import { test } from "node:test";
import assert from "node:assert/strict";
import { eventText } from "../lib/view/history.ts";

const TX = "ab".repeat(32);

test("each action in words", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["created", { title: "September contributors", network: "regtest" }, "Created as “September contributors”"],
    ["locked", { seq: 2, rate: "1600.00", source: "kraken" }, "Rate locked at 1 ZEC = $1,600.00 (lock 2)"],
    ["quoted", { seq: 3, rate: "1648.10", source: "kraken" }, "Rate checked before paying: 1 ZEC = $1,648.10"],
    ["approved", { seq: 1, lockSeq: 2, approver: "operator" }, "Approved at lock 2"],
    ["attempt_submitting", { attempts: 1, state: "submitting" }, "Payment attempt 1 started"],
    ["attempt_failed_retryable", { attempts: 1, error: "Not enough funds" }, "Payment attempt 1 sent nothing: Not enough funds"],
    ["attempt_unknown_outcome", { attempts: 2, error: "lost answer" }, "Payment attempt 2: the outcome is unknown (lost answer); it may have paid"],
    ["attempt_broadcast", { attempts: 2, txid: TX }, `Payment attempt 2 broadcast as ${TX}`],
    ["expiry_recorded", { attempts: 2, expiresBy: 740 }, "Expiry bound recorded: block 740"],
    ["voided", {}, "Voided: this batch can never be paid"],
    ["receipt_issued", { idx: 0, pool: "orchard", outputIndex: 1, txid: TX }, "Receipt issued for line 1"],
    ["exported", { format: "openzcash", rows: 3 }, "Exported as OpenZcash CSV (3 receipt links)"],
    ["exported", { format: "openzcash", rows: 1 }, "Exported as OpenZcash CSV (1 receipt link)"],
  ];
  for (const [action, detail, text] of cases) assert.equal(eventText({ action, detail }), text, action);
});

test("backfilled events say so; malformed or missing details fall back without 'undefined'; an unknown action is named", () => {
  assert.equal(eventText({ action: "locked", detail: { seq: 1, rate: "1600.00", backfilled: true } }), "Rate locked at 1 ZEC = $1,600.00 (lock 1) (recorded before the history existed)");
  for (const action of ["created", "locked", "quoted", "approved", "attempt_submitting", "attempt_broadcast", "attempt_failed_retryable", "attempt_unknown_outcome", "expiry_recorded", "receipt_issued", "exported"]) {
    const text = eventText({ action, detail: { seq: "x", rate: 5, attempts: 1.5, txid: 7, error: null, idx: -0.5, expiresBy: "y", title: "", rows: "z", format: 9 } });
    assert.ok(!/undefined|null|NaN/.test(text), `${action}: ${text}`);
  }
  assert.equal(eventText({ action: "attempt_failed_retryable", detail: {} }), "A payment attempt sent nothing");
  assert.equal(eventText({ action: "something_new", detail: {} }), "something_new");
});
