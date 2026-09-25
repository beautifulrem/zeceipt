// What the pages say about money (slice E1): every derived state has a label, tone, step and explanation;
// "confirmed" is never said without a confirmed payment (Konclave's green "Confirmed" over a mempool
// transaction, settlement.ts); unknown outcomes always warn against paying by hand; amounts are exact.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BatchState, BatchStatus, NextAction } from "../lib/data/status.ts";
import { centsText, rateText, SHORT_ADDRESS_DATA_CHARS, shortAddress, sourceName, usdText, zecParts, zecText } from "../lib/view/format.ts";
import { paymentMode } from "../lib/view/mode.ts";
import { LIFECYCLE_STEPS, NEXT_TEXT, STATUS_UNAVAILABLE, stateView, stepsFor } from "../lib/view/status.ts";
import { loadConfig } from "../lib/index.ts";

const STATES: BatchState[] = ["draft", "approved", "submitting", "retryable", "needs_attention", "pending", "confirming", "confirmed", "receipts_partial", "receipts_issued", "expired"];
const NEXTS: NextAction[] = ["approve", "submit", "wait", "issue_receipts", "resend_expired", "record_expiry", "investigate", "none"];
const st = (state: BatchState, detail: BatchStatus["detail"] = {}, next: NextAction = "wait"): BatchStatus => ({ state, next, detail });

test("every derived state has a label, a tone, a lifecycle step and an explanation; every next action has text", () => {
  for (const s of STATES) {
    const v = stateView(st(s));
    assert.ok(v.label && v.explanation && v.tone && v.step, s);
    assert.ok(LIFECYCLE_STEPS.some((x) => x.step === v.step), s);
  }
  for (const n of NEXTS) assert.ok(NEXT_TEXT[n], n);
  assert.equal(stateView(st("approved", {}, "submit")).next, "Submit the batch (with its total)");
  assert.equal(stateView(st("draft", {}, "approve")).next, "Approve the batch (its lines, total and locked rate)");
});

test("fail closed: the word 'confirmed' only for confirmed payments; 'not in a block yet' for pending", () => {
  const confirmedStates = new Set<BatchState>(["confirmed", "receipts_partial", "receipts_issued"]);
  for (const s of STATES) {
    const v = stateView(st(s, { confirmations: 1, required: 3, cause: "timeout" }));
    const says = /\bconfirmed\b/i.test(`${v.label} ${v.explanation}`) && !/\bnot confirmed\b/i.test(`${v.label} ${v.explanation}`);
    assert.equal(says, confirmedStates.has(s), `${s}: "${v.label}" / "${v.explanation}"`);
  }
  assert.match(stateView(st("pending")).label, /not in a block yet/);
  assert.match(stateView(st("pending")).explanation, /Not confirmed\./);
  assert.equal(stateView(st("confirming", { confirmations: 1, required: 3 })).label, "In a block, 1 of 3 confirmations");
});

test("wallet unreachable: only what the record proves (broadcast), and a warning against paying twice", () => {
  assert.equal(STATUS_UNAVAILABLE.label, "Status unavailable");
  assert.match(STATUS_UNAVAILABLE.explanation, /^The payment was broadcast, but the wallet did not answer, so this page cannot say whether it is in a block or confirmed\./);
  assert.match(STATUS_UNAVAILABLE.explanation, /Do not pay this batch by hand/);
  assert.deepEqual(stepsFor(STATUS_UNAVAILABLE).map((s) => s.mark), ["done", "done", "blocked", "ahead", "ahead", "ahead"], "nothing beyond Sent is claimed");
});

test("needs_attention: the cause is named, and every cause warns against paying by hand", () => {
  const causes: [BatchStatus["detail"], RegExp][] = [
    [{ stale: true }, /never finished/],
    [{ error: "lost" }, /answer was lost/],
    [{ cause: "timeout" }, /not mined for a long time/],
    [{ cause: "superseded" }, /records disagree \(superseded\)/],
  ];
  for (const [detail, why] of causes) {
    const v = stateView(st("needs_attention", detail));
    assert.match(v.explanation, why);
    assert.match(v.explanation, /may have been sent\. Do not pay this batch by hand\./);
    assert.equal(v.blocked, true);
  }
});

test("lifecycle marks: done before, current (or blocked) at, ahead after", () => {
  // Slice I3: Draft → Approved → Sent → In a block → Confirmed → Receipts.
  assert.deepEqual(LIFECYCLE_STEPS.map((s) => s.label), ["Draft", "Approved", "Sent", "In a block", "Confirmed", "Receipts"]);
  assert.deepEqual(stepsFor(stateView(st("approved"))).map((s) => s.mark), ["done", "current", "ahead", "ahead", "ahead", "ahead"]);
  assert.deepEqual(stepsFor(stateView(st("pending"))).map((s) => s.mark), ["done", "done", "current", "ahead", "ahead", "ahead"]);
  assert.deepEqual(stepsFor(stateView(st("needs_attention"))).map((s) => s.mark), ["done", "done", "blocked", "ahead", "ahead", "ahead"]);
  assert.deepEqual(stepsFor(stateView(st("receipts_issued"))).map((s) => s.mark), ["done", "done", "done", "done", "done", "current"]);
  assert.deepEqual(stepsFor(stateView(st("retryable"))).map((s) => s.mark), ["current", "ahead", "ahead", "ahead", "ahead", "ahead"]);
});

test("amounts: exact ZEC from zatoshi with a fixed 8 decimals (slice G1d), including totals beyond 21M ZEC; short addresses", () => {
  assert.equal(zecText(101_000_000n), "1.01000000 ZEC");
  assert.equal(zecText(1n), "0.00000001 ZEC");
  assert.equal(zecText(0n), "0.00000000 ZEC");
  assert.equal(zecText(100_000_000n), "1.00000000 ZEC");
  assert.equal(zecText(50_000n), "0.00050000 ZEC");
  assert.equal(zecText(10_500_000_000_000_000n), "105,000,000.00000000 ZEC");
  assert.equal(zecText(9_007_199_254_740_993n), "90,071,992.54740993 ZEC", "beyond 2^53, exact");
  // Split like Zkool's zatToText: the last five decimals are the minor part; the parts rebuild the text.
  assert.deepEqual(zecParts(101_000_000n), { major: "1.010", minor: "00000" });
  assert.deepEqual(zecParts(9_007_199_254_740_993n), { major: "90,071,992.547", minor: "40993" });
  for (const z of [0n, 1n, 50_000n, 101_000_000n, 10_500_000_000_000_000n]) {
    const p = zecParts(z);
    assert.equal(`${p.major}${p.minor} ZEC`, zecText(z));
  }
  assert.throws(() => zecText(-1n));
  const ua = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
  assert.equal(shortAddress(ua), "uregtest1qzj498rks3e6gfazv0fxns3d0…");
  assert.equal(shortAddress("short"), "short");
});

test("ZIP 316 (review H2): an abridged address is a prefix of at least 20 characters, the separator plus 25 data characters", () => {
  const cases = {
    main: "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel",
    test: "utest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
    regtest: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  };
  for (const [net, a] of Object.entries(cases)) {
    const s = shortAddress(a);
    const hrp = a.slice(0, a.lastIndexOf("1") + 1);
    assert.ok(s.endsWith("…"), net);
    const shown = s.slice(0, -1);
    assert.ok(a.startsWith(shown), `${net}: a prefix, not a middle cut`);
    assert.ok(shown.length >= 20, `${net}: ZIP 316's minimum`);
    assert.equal(shown.length, hrp.length + SHORT_ADDRESS_DATA_CHARS, `${net}: 25 data characters (125 bits)`);
  }
  assert.equal(shortAddress("u1" + "q".repeat(26)), "u1" + "q".repeat(26), "one character over: shown whole, not abridged by one");
  assert.equal(shortAddress("u1" + "q".repeat(27)), "u1" + "q".repeat(25) + "…");
});

test("centsText (slice H4): whole cents as US dollars, exact up to the cap; refuses what is not cents", () => {
  for (const [c, t] of [[0, "$0.00"], [1, "$0.01"], [50, "$0.50"], [123456, "$1,234.56"], [100_000, "$1,000.00"], [99_999_999, "$999,999.99"], [123_456_789, "$1,234,567.89"]] as const) assert.equal(centsText(c), t);
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 53]) assert.throws(() => centsText(bad), RangeError, String(bad));
});

test("payment mode: custody apart from the lifecycle, in words; nothing secret", () => {
  const base = {
    ZECEIPT_DB_PATH: "/var/lib/zeceipt/console.db",
    ZECEIPT_ORG_ID: "demo-org",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 9).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
    ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
    ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
  };
  const hot = paymentMode(loadConfig({ ...base, ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql", ZECEIPT_ZKOOL_ACCOUNT: "4" }));
  assert.deepEqual(hot, { custody: "Hot wallet: the seed lives only in Zkool; this console holds a viewing key", wallet: "Zkool, account 4", network: "Regtest (local test chain)", confirmations: "3 confirmations before receipts" });
  const ext = paymentMode(loadConfig({ ...base, ZECEIPT_CUSTODY_MODE: "external" }));
  assert.match(ext.custody, /never pays/);
  assert.ok(!JSON.stringify([hot, ext]).includes(Buffer.alloc(32, 9).toString("base64")));
});

test("USD beside an amount: exact to the cent at the locked rate, rounded half up once (slice G1c2)", () => {
  assert.equal(usdText(100_000_000n, "1616.24000"), "$1,616.24");
  assert.equal(usdText(101_000_000n, "1616.24"), "$1,632.40"); // 1.01 × 1616.24 = 1632.4024
  assert.equal(usdText(1n, "1616.24"), "$0.00"); // 0.0000161624
  assert.equal(usdText(31_000n, "1616.24"), "$0.50"); // 0.501034… rounds down
  assert.equal(usdText(30_935n, "1616.24"), "$0.50"); // 0.4999838… rounds up
  assert.equal(usdText(30_934n, "1616.24"), "$0.50"); // 0.49996… rounds up
  assert.equal(usdText(30_000n, "1616.24"), "$0.48"); // 0.484872 rounds down
  assert.equal(usdText(50_000_000n, "0.01"), "$0.01"); // exactly half a cent (0.005) rounds up
  assert.equal(usdText(2_100_000_000_000_000n, "999999999999999.999999999999999999"), "$21,000,000,000,000,000,000,000.00"); // 21M ZEC at an absurd rate: 20,999,999,999,999,999,999,999.99999999997… rounds up; no overflow, no float
  assert.equal(usdText(0n, "1616.24"), "$0.00");
  assert.equal(rateText("1610.95000"), "1 ZEC = $1,610.95");
  assert.throws(() => usdText(1n, "1e3"), RangeError);
  assert.throws(() => usdText(-1n, "1"), RangeError);
});

test("a rate source is named from its recorded id; an unknown id shows as itself (review G1c2)", () => {
  assert.equal(sourceName("kraken"), "Kraken");
  assert.equal(sourceName("coingecko"), "coingecko");
});
