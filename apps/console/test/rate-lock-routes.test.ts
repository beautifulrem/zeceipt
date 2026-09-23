// Rate-lock API (slice G1c1): POST /api/batches/{id}/rate-lock quotes from the configured source (a real local
// fake of Kraken's Ticker, reached by the real client through ZECEIPT_RATE_URL) and records the lock; GET
// /api/batches/{id} shows the current lock. The source failing locks nothing (502 with a fixed reason); a
// submitted batch is frozen (409); unknown ids are 404.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchDigest, batchNonce, bootServerContext, defaultMigrationsDir, getBatch, listQuotes, SERVER_CONTEXT_KEY, serverContext, toExecutionBatch, type BootState } from "../lib/index.ts";
import * as collection from "../app/api/batches/route.ts";
import * as item from "../app/api/batches/[id]/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";

const ORG = "org-lock";
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-rate-lock-"));
const PAYEES = [
  { payableId: "p-1", label: "R1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "INV-L-1" },
];
const TICKER = (bid: string, ask: string, last: string) => JSON.stringify({ error: [], result: { XZECZUSD: { a: [ask, "1", "1.000"], b: [bid, "1", "1.000"], c: [last, "0.1"] } } });

// The fake source: each test sets what it answers.
let answer: { status: number; body: string } = { status: 200, body: TICKER("1616.24000", "1616.97000", "1616.34000") };
let asked = 0;
const source = http.createServer((_req, res) => {
  asked++;
  res.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
});
let sourceUrl: string;

before(async () => {
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  sourceUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`;
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external",
    ZECEIPT_DB_PATH: join(dir, "console.db"),
    ZECEIPT_ORG_ID: ORG,
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 9).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
    ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
    ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
    ZECEIPT_RATE_URL: sourceUrl,
  }, { migrationsFolder: defaultMigrationsDir() });
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await new Promise((r) => source.close(r));
});

const headers = { host: HOST, origin: `http://${HOST}` };
async function newBatch(tag: string): Promise<string> {
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ title: tag, items: PAYEES.map((p) => ({ ...p, memo: `${p.memo}-${tag}` })) }) }), undefined);
  assert.equal(r.status, 201);
  const body = (await r.json()) as { id: string; rateLock: unknown };
  assert.equal(body.rateLock, null, "a new batch is not locked");
  return body.id;
}
const lock = async (id: string) => {
  const r = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${id}/rate-lock`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
  return { status: r.status, cache: r.headers.get("cache-control"), retry: r.headers.get("retry-after"), body: (await r.json()) as Record<string, unknown> };
};
const read = async (id: string) => (await (await item.GET(new Request(`http://${HOST}/api/batches/${id}`, { headers }), { params: Promise.resolve({ id }) })).json()) as { rateLock: Record<string, unknown> | null };

test("a lock: 201 with the source's exact strings; GET shows it; a re-lock appends and becomes current", async () => {
  const id = await newBatch("ok");
  answer = { status: 200, body: TICKER("1616.24000", "1616.97000", "1616.34000") };
  const first = await lock(id);
  assert.equal(first.status, 201);
  assert.equal(first.cache, "no-store");
  const { recordedAt, fetchedAt, ...rest } = first.body;
  assert.deepEqual(rest, { seq: 1, source: "kraken", pair: "XZECZUSD", bid: "1616.24000", ask: "1616.97000", last: "1616.34000", rate: "1616.24000" });
  assert.match(String(fetchedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(String(recordedAt), /Z$/);
  assert.deepEqual((await read(id)).rateLock, first.body);
  answer = { status: 200, body: TICKER("1590.1", "1590.9", "1590.5") };
  const second = await lock(id);
  assert.deepEqual([second.status, second.body.seq, second.body.rate], [201, 2, "1590.1"]);
  assert.equal((await read(id)).rateLock!.seq, 2);
});

test("the source failing locks nothing: 502 rate_unavailable with a fixed reason; the current lock is unchanged", async () => {
  const id = await newBatch("down");
  answer = { status: 200, body: TICKER("1616.24000", "1616.97000", "1616.34000") };
  assert.equal((await lock(id)).status, 201);
  const cases: [typeof answer, string][] = [
    [{ status: 503, body: "busy" }, "http"],
    [{ status: 200, body: "<html>" }, "json"],
    [{ status: 200, body: JSON.stringify({ error: ["EService:Unavailable"] }) }, "source_error"],
    [{ status: 200, body: JSON.stringify({ error: [], result: {} }) }, "pair_missing"],
    [{ status: 200, body: TICKER("0", "1", "1") }, "bad_price"],
    [{ status: 200, body: TICKER("1700", "1600", "1650") }, "crossed_book"],
  ];
  for (const [a, reason] of cases) {
    answer = a;
    const r = await lock(id);
    assert.equal(r.status, 502, reason);
    assert.deepEqual([r.body.code, r.body.reason], ["rate_unavailable", reason]);
    assert.match(String(r.body.detail), /nothing was locked/);
    assert.ok(!JSON.stringify(r.body).includes("EService"), "the source's own text never reaches the response");
  }
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  assert.equal((await listQuotes(db, config.orgId, id)).length, 1, "nothing recorded");
  assert.equal((await read(id)).rateLock!.seq, 1);
});

test("a source that cannot be reached is 502 network", async () => {
  const id = await newBatch("gone");
  const saved = slot[SERVER_CONTEXT_KEY]!;
  // Point a fresh context at a port nobody listens on.
  slot[SERVER_CONTEXT_KEY] = Object.freeze({ ...saved, config: Object.freeze({ ...saved.config, rateUrl: "http://127.0.0.1:1/ticker" }) });
  try {
    const r = await lock(id);
    assert.deepEqual([r.status, r.body.reason], [502, "network"]);
  } finally {
    slot[SERVER_CONTEXT_KEY] = saved;
  }
});

test("a submitted batch is frozen: 409 batch_frozen before the source is asked; nothing recorded", async () => {
  const id = await newBatch("frozen");
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  const rec = (await getBatch(db, config.orgId, id))!;
  await serverContext().store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: new Date().toISOString(), attempts: 1 });
  answer = { status: 200, body: TICKER("1616.24000", "1616.97000", "1616.34000") };
  const before = asked;
  const r = await lock(id);
  assert.deepEqual([r.status, r.body.code], [409, "batch_frozen"]);
  assert.equal(asked, before, "the source was not asked");
  assert.equal((await listQuotes(db, config.orgId, id)).length, 0);
});

test("the pre-check finds a submission by batch, as the freeze triggers do, whatever its nonce (review G1c1)", async () => {
  const id = await newBatch("othernonce");
  const { db, config } = slot[SERVER_CONTEXT_KEY]!;
  const rec = (await getBatch(db, config.orgId, id))!;
  await serverContext().store.createIntent({ nonce: `tool/${id}`, batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: new Date().toISOString(), attempts: 1 });
  const before = asked;
  const r = await lock(id);
  assert.deepEqual([r.status, r.body.code], [409, "batch_frozen"]);
  assert.equal(asked, before, "refused before the source was asked");
});

test("unknown or malformed ids are 404; the guard refuses a cross-site post", async () => {
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) assert.equal((await lock(id)).status, 404);
  const r = await lockRoute.POST(new Request(`http://${HOST}/api/batches/x/rate-lock`, { method: "POST", headers: { host: HOST, origin: "https://evil.example" } }), { params: Promise.resolve({ id: "x" }) });
  assert.equal(r.status, 403);
});
