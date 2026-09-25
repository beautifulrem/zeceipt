// Submit and status routes (slice D2) through the real route exports, against the fake Zkool and a
// temporary database: pays once (replay returns the same txid with Idempotent-Replayed), status moves
// draft → pending → confirming → confirmed, and every failure states whether money may have moved
// (`thisRequest`, checked against the fake wallet's pay counter), links the batch status, never quotes
// the wallet, and never reports an uncertain outcome as a failure.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchNonce, bootServerContext, defaultMigrationsDir, getBatch, listQuotes, SERVER_CONTEXT_KEY, serverContext, type BootState } from "../lib/index.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";
import type { BatchJson } from "../lib/http/batches.ts";
import type { ProblemJson } from "../lib/http/problem.ts";
import * as collection from "../app/api/batches/route.ts";
import * as submitRoute from "../app/api/batches/[id]/submit/route.ts";
import * as statusRoute from "../app/api/batches/[id]/status/route.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { approve } from "./helpers/approve.ts";
import { ZKOOL_PUBLIC_PEM, zkoolTokenFile } from "./helpers/zkool-token.ts";

const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-submit-"));
const WALLET_TEXT = ["Not enough funds, 1.5 more ZEC", "tcp connect error", "bad-txns", "Unavailable"];
let fake: FakeZkool;
let n = 0;

type Body = Partial<BatchJson> & Partial<ProblemJson> & { txid?: string; replayed?: boolean; via?: string; batchId?: string; state?: string; next?: string; detail?: Record<string, unknown> };
const read = async (r: Response) => ({ status: r.status, headers: r.headers, text: "", body: (await r.json()) as Body });
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// A fake of Kraken's Ticker (ZECEIPT_RATE_URL). Submit re-quotes it (REQ-CON-21, slice G2b1); tests set `tick`.
const ticker = (bid: string) => JSON.stringify({ error: [], result: { XZECZUSD: { a: [(Number(bid) + 1).toFixed(2), "1", "1"], b: [bid, "1", "1"], c: [bid, "0.1"] } } });
let tick = { status: 200, body: ticker("1600.00") };
let quotes = 0;
const source = http.createServer((_req, res) => {
  quotes++;
  res.writeHead(tick.status, { "content-type": "application/json" }).end(tick.body);
});
let sourceUrl = "";

/**
 * A draft; locked at the ticker's current rate unless `lock: false` (submit requires a lock since G2b1), and approved
 * as it is unless `approve: false` (every payment requires an approval since I3).
 */
async function createDraft(zat = ["1000", "2500"], opts: { lock?: boolean; approve?: boolean } = {}) {
  n++;
  const body = { title: `batch ${n}`, items: zat.map((z, i) => ({ payableId: `p${n}-${i}`, address: R[i % 2], zat: z, memo: `M${n}-${i}` })) };
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify(body) }), undefined);
  assert.equal(r.status, 201);
  const b = (await r.json()) as BatchJson;
  if (opts.lock !== false) {
    const l = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.id}/rate-lock`, { method: "POST", headers }), params(b.id));
    assert.equal(l.status, 201, "locked");
    if (opts.approve !== false) await approve(b.id);
  }
  return b;
}
const submit = (id: string, body: unknown, init: RequestInit = {}) =>
  submitRoute.POST(new Request(`http://${HOST}/api/batches/${id}/submit`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), ...init }), params(id));
const status = async (id: string) => read(await statusRoute.GET(new Request(`http://${HOST}/api/batches/${id}/status`, { headers: { host: HOST } }), params(id)));
const noWalletText = (b: Body) => {
  const s = JSON.stringify(b);
  for (const w of WALLET_TEXT) assert.ok(!s.includes(w), `wallet text ${JSON.stringify(w)} in ${s.slice(0, 200)}`);
};

function boot(extra: Record<string, string | undefined> = {}) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  const env: Record<string, string | undefined> = {
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: fake.url,
    ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9),
    ZECEIPT_DB_PATH: join(dir, `ctx-${extra.ZECEIPT_CUSTODY_MODE ?? "hot"}.db`),
    ZECEIPT_ORG_ID: "demo-org",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
    ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
    ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
    ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: sourceUrl,
    ...extra,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return bootServerContext(env, { migrationsFolder: defaultMigrationsDir() });
}

before(async () => {
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  sourceUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`;
  boot();
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
  await new Promise((r) => source.close(r));
});

test("pays once: 202 with a txid, a replay returns the same txid with Idempotent-Replayed; status follows the chain", async () => {
  const b = await createDraft();
  assert.deepEqual((await status(b.id!)).body, { batchId: b.id, state: "approved", next: "submit", detail: { items: 2 } });
  const calls = fake.payCalls;
  const first = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  assert.equal(first.status, 202);
  assert.match(first.body.txid!, /^[0-9a-f]{64}$/);
  assert.deepEqual([first.body.replayed, first.body.via, first.headers.get("idempotent-replayed")], [false, "fresh", null]);
  assert.equal(first.headers.get("location"), `/api/batches/${b.id}/status`);
  assert.equal(first.headers.get("cache-control"), "no-store");

  const again = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  assert.equal(again.status, 202);
  assert.deepEqual([again.body.txid, again.body.replayed, again.body.via, again.headers.get("idempotent-replayed")], [first.body.txid, true, "record", "true"]);
  assert.equal(fake.payCalls, calls + 1, "exactly one pay");

  assert.equal((await status(b.id!)).body.state, "pending");
  fake.mine();
  const confirming = await status(b.id!);
  assert.deepEqual([confirming.body.state, confirming.body.next, confirming.body.detail?.confirmations], ["confirming", "wait", 1]);
  fake.mine(2);
  const confirmed = await status(b.id!);
  assert.deepEqual([confirmed.body.state, confirmed.body.next, confirmed.body.detail?.txid], ["confirmed", "issue_receipts", first.body.txid]);
});

test("confirmation: missing, malformed or mismatched totals are refused before any wallet call", async () => {
  const b = await createDraft();
  const calls = fake.payCalls;
  for (const [body, code] of [[{}, "body_invalid"], [{ confirmTotalZat: 3500 }, "body_invalid"], [{ confirmTotalZat: "3500", extra: 1 }, "body_invalid"], [{ confirmTotalZat: "3499" }, "confirmation_mismatch"]] as const) {
    const r = await read(await submit(b.id!, body));
    assert.equal(r.body.code, code, JSON.stringify(body));
    assert.equal(r.body.thisRequest, "sent_nothing");
  }
  assert.equal((await read(await submit(b.id!, "{", {}))).body.code, "malformed_json");
  assert.equal(fake.payCalls, calls, "pay never called");
  assert.equal((await status(b.id!)).body.state, "approved", "still approved, never sent");
});

test("refused before build: 409 payment_rejected, sent_nothing, no wallet text; a resubmit pays", async () => {
  const b = await createDraft();
  fake.nextPay = "refused";
  const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest, r.body.batchStatus], [409, "payment_rejected", "sent_nothing", `/api/batches/${b.id}/status`]);
  noWalletText(r.body);
  const s = await status(b.id!);
  assert.deepEqual([s.body.state, s.body.next], ["retryable", "submit"]);
  assert.match(String(s.body.detail?.error), /Not enough funds/, "the operator sees the wallet's reason in the status");
  const paid = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  assert.deepEqual([paid.status, paid.body.replayed], [202, false]);
});

test("preflight failure: 422 with problems, sent_nothing", async () => {
  const b = await createDraft(["2000000000"]); // 20 ZEC > the fake's 10 ZEC
  const calls = fake.payCalls;
  const r = await read(await submit(b.id!, { confirmTotalZat: "2000000000" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [422, "preflight_failed", "sent_nothing"]);
  assert.deepEqual(r.body.problems!.map((p) => p.code), ["insufficient_funds"]);
  assert.equal(fake.payCalls, calls);
});

test("uncertain outcomes: 502 outcome_unknown, may_have_sent; status never shows draft or failure", async () => {
  for (const mode of ["grpc-error-sent", "node-rejected"] as const) {
    const b = await createDraft();
    fake.nextPay = mode;
    const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([r.status, r.body.code, r.body.thisRequest, r.body.batchStatus], [502, "outcome_unknown", "may_have_sent", `/api/batches/${b.id}/status`], mode);
    noWalletText(r.body);
    const s = await status(b.id!);
    assert.ok(!["draft", "retryable", "pending", "confirmed"].includes(s.body.state!), `${mode}: status ${s.body.state}`);
    assert.equal(s.body.state, "needs_attention");
  }
});

test("a second submit while the first is paying: 409 submission_in_flight with Retry-After; the first completes", async () => {
  const b = await createDraft();
  fake.payDelayMs = 600;
  try {
    const first = submit(b.id!, { confirmTotalZat: "3500" });
    await new Promise((r) => setTimeout(r, 150));
    const calls = fake.payCalls;
    const second = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([second.status, second.body.code, second.body.thisRequest, second.headers.get("retry-after")], [409, "submission_in_flight", "sent_nothing", "5"]);
    assert.equal(fake.payCalls, calls, "the second request paid nothing");
    assert.match(second.body.detail!, /up to 10 minutes/);
    assert.equal((await read(await first)).status, 202);
  } finally {
    fake.payDelayMs = 0;
  }
});

test("a client that disconnects mid-pay does not abort the pay: the broadcast is recorded", async () => {
  const b = await createDraft();
  fake.payDelayMs = 300;
  try {
    const ac = new AbortController();
    const pending = submit(b.id!, { confirmTotalZat: "3500" }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const r = await pending;
    assert.equal(r.status, 202);
    assert.equal((await status(b.id!)).body.state, "pending");
  } finally {
    fake.payDelayMs = 0;
  }
});

test("store busy (another process holds the write lock): 503 store_busy, Retry-After, sent_nothing", async () => {
  const b = await createDraft();
  const other = new Database(slot[SERVER_CONTEXT_KEY]!.config.dbPath);
  other.exec("BEGIN IMMEDIATE");
  try {
    const calls = fake.payCalls;
    const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([r.status, r.body.code, r.body.thisRequest, r.headers.get("retry-after")], [503, "store_busy", "sent_nothing", "1"]);
    assert.equal(fake.payCalls, calls);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
});

test("nonce conflict: 409 nonce_conflict, sent_nothing", async () => {
  const b = await createDraft();
  const rec = (await getBatch(slot[SERVER_CONTEXT_KEY]!.db, "demo-org", b.id!))!;
  await serverContext().store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: "0".repeat(64), state: "submitting", createdAt: new Date().toISOString(), attempts: 1 });
  const calls = fake.payCalls;
  const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [409, "nonce_conflict", "sent_nothing"]);
  assert.equal(fake.payCalls, calls);
});

test("unknown batch: 404 on both routes; the wallet unreachable before any pay: 502 wallet_unavailable, sent_nothing", async () => {
  for (const r of [await read(await submit("0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f", { confirmTotalZat: "1" })), await status("nope")]) {
    assert.deepEqual([r.status, r.body.code], [404, "batch_not_found"]);
  }
  const b = await createDraft();
  const paid = await createDraft();
  assert.equal((await submit(paid.id!, { confirmTotalZat: "3500" })).status, 202);
  await fake.stop();
  try {
    // A status read of a broadcast batch needs the wallet: 502, claiming nothing (no thisRequest: reads never pay).
    const st = await status(paid.id!);
    assert.deepEqual([st.status, st.body.code, st.body.thisRequest], [502, "wallet_unavailable", undefined]);
    const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [502, "wallet_unavailable", "sent_nothing"]);
    noWalletText(r.body);
  } finally {
    fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  }
});

test("review D2 round 1: a resubmit of a PAID batch that meets a busy store says what this request did, and links the batch's status", async () => {
  boot(); // the wallet-outage test restarted the fake on a new port
  const b = await createDraft();
  assert.equal((await read(await submit(b.id!, { confirmTotalZat: "3500" }))).status, 202);
  const other = new Database(slot[SERVER_CONTEXT_KEY]!.config.dbPath);
  other.exec("BEGIN IMMEDIATE");
  let r;
  try {
    r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest, r.body.batchStatus], [503, "store_busy", "sent_nothing", `/api/batches/${b.id}/status`]);
  assert.doesNotMatch(r.body.detail!, /nothing was sent/, "no claim about the batch");
  assert.match(r.body.detail!, /this request sent nothing/);
  assert.equal((await status(b.id!)).body.state, "pending", "the status route says the batch was paid");
});

test("an unrecognised failure after the backend was reached is indeterminate (500, may_have_sent); before it, sent_nothing", async () => {
  const b = await createDraft();
  const backend = serverContext().backend!;
  const original = backend.submit;
  backend.submit = async () => {
    throw new TypeError("boom inside the backend");
  };
  try {
    const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([r.status, r.body.code, r.body.thisRequest, r.body.batchStatus], [500, "internal", "may_have_sent", `/api/batches/${b.id}/status`]);
    assert.ok(!JSON.stringify(r.body).includes("boom"));
  } finally {
    backend.submit = original;
  }
  const ctx = slot[SERVER_CONTEXT_KEY]!;
  const getBatchFails = ctx.db.$client;
  const prepare = getBatchFails.prepare.bind(getBatchFails);
  getBatchFails.prepare = (() => {
    throw new TypeError("boom before the backend");
  }) as typeof getBatchFails.prepare;
  try {
    const r = await read(await submit(b.id!, { confirmTotalZat: "3500" }));
    assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [500, "internal", "sent_nothing"]);
  } finally {
    getBatchFails.prepare = prepare;
  }
});

test("external custody: no backend; submit and status answer 409 custody_external", async () => {
  const ctx = boot({ ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined });
  assert.equal(ctx.backend, undefined);
  const b = await createDraft(undefined, { approve: false }); // external custody takes no approvals (approve-routes)
  for (const r of [await read(await submit(b.id!, { confirmTotalZat: "3500" })), await status(b.id!)]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "custody_external");
  }
});

// REQ-CON-21 in submit (slice G2b1): a lock is required; the first submit re-quotes, records the execution quote,
// and refuses a move beyond ZECEIPT_RATE_MAX_DRIFT_BPS (300 bp by default). Every refusal happens before the
// wallet: sent_nothing, no pay call. A retry after a submission is never re-judged.
test("no lock: 409 rate_not_locked, sent_nothing, the source not asked, no pay call", async () => {
  boot(); // hot custody (the test before these boots external)
  const b = await createDraft(["1000"], { lock: false });
  const calls = fake.payCalls;
  const asked = quotes;
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [409, "rate_not_locked", "sent_nothing"]);
  assert.equal(quotes, asked, "no quote taken");
  assert.equal(fake.payCalls, calls);
});

test("a move beyond the limit: 409 rate_moved with both rates, the execution quote recorded, sent_nothing; re-lock, then it pays", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1600.00") };
  const b = await createDraft(["1000"]);
  tick = { status: 200, body: ticker("1680.00") }; // +5.00%
  const calls = fake.payCalls;
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [409, "rate_moved", "sent_nothing"]);
  const rate = (r.body as { rate?: Record<string, unknown> }).rate!;
  assert.deepEqual([rate.lock, rate.execution, rate.driftBps, rate.maxDriftBps, rate.direction], ["1600.00", "1680.00", "500.00", 300, "up"]);
  assert.match(String(r.body.detail), /moved 5\.00% since the lock; at most 3\.00% is allowed; re-lock/);
  assert.equal(fake.payCalls, calls, "nothing paid");
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  assert.deepEqual((await listQuotes(db, config.orgId, b.id!)).map((q) => [q.purpose, q.rate]), [["lock", "1600.00"], ["execution", "1680.00"]], "the refusal keeps its evidence");
  // Re-lock at the new rate: the approval named the old lock, so the next attempt is refused until approved again (I3).
  const relock = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.id}/rate-lock`, { method: "POST", headers }), params(b.id!));
  assert.equal(relock.status, 201);
  assert.deepEqual([(await status(b.id!)).body.state, (await status(b.id!)).body.next], ["draft", "approve"], "a re-lock voids the approval");
  const unapproved = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([unapproved.status, unapproved.body.code, unapproved.body.thisRequest, unapproved.body.batchStatus], [409, "not_approved", "sent_nothing", `/api/batches/${b.id}/status`]);
  assert.equal(fake.payCalls, calls, "nothing paid without an approval");
  await approve(b.id!);
  // Now within the limit and approved at the new lock, it pays.
  const paid = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(paid.status, 202);
  assert.equal(fake.payCalls, calls + 1);
});

test("within the limit (exactly 3% down) it pays; the move is recorded", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1000.00") };
  const b = await createDraft(["1000"]);
  tick = { status: 200, body: ticker("970.00") };
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  assert.deepEqual((await listQuotes(db, config.orgId, b.id!)).map((q) => [q.purpose, q.rate]), [["lock", "1000.00"], ["execution", "970.00"]]);
});

test("just past the limit the message says 'more than', never a figure equal to the limit (review G2a)", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1000.00") };
  const b = await createDraft(["1000"]);
  tick = { status: 200, body: JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1031", "1", "1"], b: ["1030.00000001", "1", "1"], c: ["1030", "0.1"] } } }) };
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(r.body.code, "rate_moved");
  assert.equal((r.body as { rate?: { driftBps?: string } }).rate!.driftBps, "300.00", "the display figure is floored to the limit");
  assert.match(String(r.body.detail), /moved more than 3\.00% since the lock/);
});

test("a real quote just past the limit (1000.00 → 1030.05, 300.50 bp) says 'more than 3.00%' (review G2b2)", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1000.00") };
  const b = await createDraft(["1000"]);
  tick = { status: 200, body: ticker("1030.05") };
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(r.body.code, "rate_moved");
  assert.equal((r.body as { rate?: { driftBps?: string } }).rate!.driftBps, "300.50");
  assert.match(String(r.body.detail), /moved more than 3\.00% since the lock; at most 3\.00% is allowed/);
  tick = { status: 200, body: ticker("1600.00") };
});

test("the source failing at submit: 502 rate_unavailable with a reason, sent_nothing, no pay call", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1600.00") };
  const b = await createDraft(["1000"]);
  tick = { status: 503, body: "busy" };
  const calls = fake.payCalls;
  const r = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest, (r.body as { reason?: string }).reason], [502, "rate_unavailable", "sent_nothing", "http"]);
  assert.equal(fake.payCalls, calls);
  tick = { status: 200, body: ticker("1600.00") };
});

test("a replay of a broadcast payment is never re-judged: the market moving afterwards still replays the same txid", async () => {
  boot(); // hot custody (the test before these boots external)
  tick = { status: 200, body: ticker("1600.00") };
  const b = await createDraft(["1000"]);
  const first = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(first.status, 202);
  tick = { status: 200, body: ticker("2000.00") }; // +25%: would be refused on a first submit
  const asked = quotes;
  const replay = await submit(b.id!, { confirmTotalZat: "1000" });
  const body = (await replay.json()) as { txid?: string };
  assert.deepEqual([replay.status, replay.headers.get("idempotent-replayed"), body.txid], [202, "true", (first.body as { txid?: string }).txid]);
  assert.equal(quotes, asked, "no re-quote for a batch that already has a submission");
  tick = { status: 200, body: ticker("1600.00") };
});

// Review G2b1 round 1: the guard also runs on retries that will pay. A refused first attempt, then the market
// +25%: the resubmit is refused (sent_nothing, a fresh execution quote), the batch can be re-locked, then it pays.
test("a wallet refusal, then the market moves: the retry is re-judged (409 rate_moved), re-lock works, then it pays once", async () => {
  boot();
  tick = { status: 200, body: ticker("1600.00") };
  const b = await createDraft(["1000"]);
  fake.nextPay = "refused";
  const first = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([first.status, first.body.code, first.body.thisRequest], [409, "payment_rejected", "sent_nothing"]);
  tick = { status: 200, body: ticker("2000.00") }; // +25%
  const pays = fake.payCalls;
  const retry = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([retry.status, retry.body.code, retry.body.thisRequest], [409, "rate_moved", "sent_nothing"], "re-judged, and nothing was sent");
  assert.equal(fake.payCalls, pays);
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  assert.deepEqual((await listQuotes(db, config.orgId, b.id!)).map((q) => [q.purpose, q.rate]), [["lock", "1600.00"], ["execution", "1600.00"], ["execution", "2000.00"]], "a fresh execution quote for the retry");
  const relock = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.id}/rate-lock`, { method: "POST", headers }), params(b.id!));
  assert.equal(relock.status, 201, "a refused batch can be re-locked (its submission is failed_retryable)");
  assert.deepEqual([(await status(b.id!)).body.state, (await status(b.id!)).body.next], ["retryable", "approve"], "the retry needs an approval at the new lock");
  await approve(b.id!);
  const paid = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(paid.status, 202);
  assert.equal(fake.payCalls, pays + 1, "exactly one more pay");
  // Once paid (broadcast), the lock is frozen again.
  const late = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.id}/rate-lock`, { method: "POST", headers }), params(b.id!));
  assert.equal(late.status, 409);
  tick = { status: 200, body: ticker("1600.00") };
});

test("an attempt proven unminable, then the market moves: the re-send is re-judged, re-lock works, then it pays once", async () => {
  boot();
  tick = { status: 200, body: ticker("1600.00") };
  const b = await createDraft(["1000"]);
  fake.nextPay = "node-rejected";
  const first = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([first.status, first.body.code], [502, "outcome_unknown"]);
  fake.advance(51); // the attempt's expiry bound passed and nothing was mined: it can never be mined
  tick = { status: 200, body: ticker("2000.00") };
  const pays = fake.payCalls;
  const resend = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.deepEqual([resend.status, resend.body.code, resend.body.thisRequest], [409, "rate_moved", "sent_nothing"]);
  assert.equal(fake.payCalls, pays);
  assert.equal((await status(b.id!)).body.state, "retryable", "the record says what is true: nothing was paid");
  assert.equal((await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.id}/rate-lock`, { method: "POST", headers }), params(b.id!))).status, 201);
  await approve(b.id!);
  const paid = await read(await submit(b.id!, { confirmTotalZat: "1000" }));
  assert.equal(paid.status, 202);
  assert.equal(fake.payCalls, pays + 1);
  fake.mine();
  tick = { status: 200, body: ticker("1600.00") };
});
