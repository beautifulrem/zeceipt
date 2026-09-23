// ZEC/USD quote client (slice G1a): exact strings, the bid as the rate, our clock, and every failure closed
// (no cache, no default: zecpay's silent 35.0 is the anti-pattern, R46). Opt-in live check: ZECEIPT_LIVE_RATES=1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDecimal, fetchZecUsdQuote, isPositiveDecimal, KRAKEN_TICKER_URL, RateUnavailableError, type RateFailure } from "../lib/index.ts";

// The live answer's shape (2026-09-23), trimmed to the fields that matter.
const SAMPLE = { error: [], result: { XZECZUSD: { a: ["1616.97000", "2", "2.000"], b: ["1616.24000", "1", "1.000"], c: ["1616.34000", "0.15125300"], p: ["1610.99488", "1539.27982"] } } };
const NOW = new Date("2026-09-23T03:40:00.123Z");
const answering = (body: unknown, init: ResponseInit = { status: 200 }): typeof fetch => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
const quote = (f: typeof fetch, timeoutMs?: number) => fetchZecUsdQuote({ fetch: f, now: () => NOW, timeoutMs });
async function fails(f: typeof fetch, reason: RateFailure, timeoutMs?: number) {
  await assert.rejects(quote(f, timeoutMs), (e: unknown) => {
    assert.ok(e instanceof RateUnavailableError, String(e));
    assert.equal(e.code, "rate_unavailable");
    assert.equal(e.reason, reason);
    return true;
  });
}
const withTicker = (patch: Record<string, unknown>) => ({ error: [], result: { XZECZUSD: { ...SAMPLE.result.XZECZUSD, ...patch } } });

test("a quote keeps Kraken's strings exactly, uses the bid as the rate, and our clock as the time", async () => {
  let asked: { url: string; init?: RequestInit } | undefined;
  const f: typeof fetch = async (url, init) => {
    asked = { url: String(url), init };
    return answering(SAMPLE)(url, init);
  };
  assert.deepEqual(await quote(f), { source: "kraken", pair: "XZECZUSD", bid: "1616.24000", ask: "1616.97000", last: "1616.34000", rate: "1616.24000", fetchedAt: "2026-09-23T03:40:00.123Z" });
  assert.equal(asked!.url, KRAKEN_TICKER_URL);
  assert.equal(asked!.init?.redirect, "error", "a redirect is refused, not followed");
  assert.equal(asked!.init?.cache, "no-store");
  assert.ok(asked!.init?.signal instanceof AbortSignal, "every request has a timeout");
});

test("every failure is RateUnavailableError with its reason; never a number", async () => {
  await fails(async () => { throw new TypeError("fetch failed"); }, "network");
  await fails(answering({ error: [] }, { status: 503 }), "http");
  await fails(answering("<html>busy</html>"), "json");
  await fails(answering({ error: ["EQuery:Unknown asset pair"] }), "source_error");
  await fails(answering({ error: [], result: { XXBTZUSD: SAMPLE.result.XZECZUSD } }), "pair_missing");
  await fails(answering({ error: [], result: {} }), "pair_missing");
  await fails(answering({ error: [] }), "pair_missing");
  for (const bad of [{ b: ["0.00000", "1", "1"] }, { a: ["-1616.9", "1", "1"] }, { c: ["1.6e3", "1"] }, { b: [1616.24, "1", "1"] }, { a: [] }, { c: "1616.3" }, { b: ["1,616.24", "1", "1"] }]) {
    await fails(answering(withTicker(bad)), "bad_price");
  }
  await fails(answering(withTicker({ b: ["1617.00000", "1", "1"], a: ["1616.97000", "1", "1"] })), "crossed_book");
  // A locked book (bid = ask) is usable.
  assert.equal((await quote(answering(withTicker({ b: ["1616.97", "1", "1"], a: ["1616.97000", "1", "1"] })))).rate, "1616.97");
});

test("a source that never answers is abandoned at the timeout", async () => {
  const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
  const t0 = Date.now();
  await fails(hang, "network", 150);
  assert.ok(Date.now() - t0 < 2_000, "gave up promptly");
});

test("decimals compare exactly and reject anything but plain digits", () => {
  assert.equal(compareDecimal("0.3", "0.30000000000000004"), -1, "beyond float precision");
  assert.equal(compareDecimal("1616.24000", "1616.24"), 0);
  assert.equal(compareDecimal("1616.240000000001", "1616.24"), 1);
  assert.equal(compareDecimal("99999999999999.999999999999999999", "100000000000000"), -1);
  assert.equal(compareDecimal("2", "10"), -1);
  for (const ok of ["1", "0.1", "1616.97000", "000.5"]) assert.equal(isPositiveDecimal(ok), true, ok);
  for (const no of ["0", "0.000", "-1", "+1", "1e3", " 1", "1 ", "1,5", "1.", ".5", "", "NaN", "Infinity", "0x10"]) assert.equal(isPositiveDecimal(no), false, no);
  assert.throws(() => compareDecimal("1e3", "1"));
});

test("live: Kraken answers a usable ZEC/USD quote (ZECEIPT_LIVE_RATES=1)", { skip: process.env.ZECEIPT_LIVE_RATES !== "1" && "set ZECEIPT_LIVE_RATES=1" }, async () => {
  const q = await fetchZecUsdQuote();
  assert.equal(q.pair, "XZECZUSD");
  assert.ok(compareDecimal(q.bid, q.ask) <= 0 && isPositiveDecimal(q.last));
  console.log(JSON.stringify(q));
});
