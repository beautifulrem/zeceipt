// What the page says after an action (slice E2), from the API's own answers: every submit and receipts
// outcome maps to plain words; `thisRequest` becomes a sentence; an uncertain outcome is never a failure;
// the wallet's text never appears (details are the problems' fixed text).

import { test } from "node:test";
import assert from "node:assert/strict";
import { problem } from "../lib/http/problem.ts";
import { receiptsOutcome, submitOutcome } from "../lib/view/outcome.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TXID = "a".repeat(64);

test("submit: broadcast, replay, and every problem with its verdict", async () => {
  assert.deepEqual(await submitOutcome(json(202, { txid: TXID, replayed: false })), { tone: "info", headline: "Broadcast", detail: `Sent as ${TXID}. Waiting for it to be mined.` });
  assert.deepEqual(await submitOutcome(json(202, { txid: TXID, replayed: true })), { tone: "info", headline: "Already sent", detail: `This batch was already sent as ${TXID}; nothing new was paid.` });
  const nothing = await submitOutcome(problem(409, "payment_rejected", "the wallet refused before building a transaction", { thisRequest: "sent_nothing" }));
  assert.deepEqual(nothing, { tone: "warning", headline: "Not done", detail: "the wallet refused before building a transaction. This request sent nothing." });
  const maybe = await submitOutcome(problem(502, "outcome_unknown", "the wallet's answer was lost", { thisRequest: "may_have_sent" }));
  assert.equal(maybe.headline, "Outcome unknown", "an uncertain outcome is never labelled a failure");
  assert.equal(maybe.tone, "danger");
  assert.match(maybe.detail, /This request may have paid\. Check the status before acting\.$/);
  for (const code of ["preflight_failed", "submission_in_flight", "nonce_conflict", "store_busy", "wallet_unavailable", "confirmation_mismatch", "body_invalid", "custody_external", "batch_not_found"]) {
    const o = await submitOutcome(problem(409, code, `fixed ${code}`, code === "batch_not_found" || code === "custody_external" ? {} : { thisRequest: "sent_nothing" }));
    assert.equal(o.headline, "Not done", code);
    assert.ok(o.detail.startsWith(`fixed ${code}`), code);
  }
  const internal = await submitOutcome(problem(500, "internal", "the console could not complete this request and it may have paid", { thisRequest: "may_have_sent" }));
  assert.equal(internal.headline, "Outcome unknown");
});

test("receipts: issued (201 or 200), waiting (202), and problems", async () => {
  assert.deepEqual(await receiptsOutcome(json(201, { receipts: [1, 2, 3] })), { tone: "success", headline: "Receipts issued", detail: "3 receipts issued, one per item." });
  assert.deepEqual(await receiptsOutcome(json(200, { receipts: [1] })), { tone: "success", headline: "Receipts issued", detail: "1 receipt issued, one per item." });
  assert.deepEqual(await receiptsOutcome(json(202, { state: "waiting", confirmations: 1, required: 3 })), { tone: "info", headline: "Waiting", detail: "Receipts are issued after 3 confirmations; the payment has 1." });
  const failed = await receiptsOutcome(problem(502, "issuance_failed", "zeceipt issue failed or its receipts do not match the batch; nothing was recorded"));
  assert.deepEqual(failed, { tone: "warning", headline: "Not done", detail: "zeceipt issue failed or its receipts do not match the batch; nothing was recorded." });
  assert.equal((await receiptsOutcome(problem(409, "not_ready_for_receipts", "receipts are issued only for a confirmed payment"))).headline, "Not done");
});
