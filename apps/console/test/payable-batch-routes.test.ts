// POST /api/batches/from-payables (slice H5a) through the real route exports, quoting from a real local fake of
// Kraken's Ticker reached by the real client (ZECEIPT_RATE_URL): 201 with the lines converted at the lock that
// comes back with them; GET shows the cents and `rateFixed`; a re-lock is 409 rate_fixed; 400, 422 (checked
// before any quote), 502 (nothing created), the guard's 403, and 503 under a held write lock.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, createPayable, createRecipient, defaultMigrationsDir, listQuotes, SERVER_CONTEXT_KEY, usdCentsToZat, type BootState } from "../lib/index.ts";
import * as fromPayables from "../app/api/batches/from-payables/route.ts";
import * as item from "../app/api/batches/[id]/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";

const ORG = "org-h5r";
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-h5-routes-"));
const DB = join(dir, "console.db");
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const TICKER = (bid: string, ask: string) => JSON.stringify({ error: [], result: { XZECZUSD: { a: [ask, "1", "1.000"], b: [bid, "1", "1.000"], c: [bid, "0.1"] } } });

let answer = { status: 200, body: TICKER("31.41592", "31.50000") };
let asked = 0;
const source = http.createServer((_req, res) => {
  asked++;
  res.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
});
let alice: string;

before(async () => {
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: DB, ZECEIPT_ORG_ID: ORG, ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 9).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
  }, { migrationsFolder: defaultMigrationsDir() });
  alice = (await createRecipient(slot[SERVER_CONTEXT_KEY]!.db, { orgId: ORG, network: "regtest", displayName: "Alice", address: UA })).id;
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await new Promise((r) => source.close(r));
});

let n = 0;
const payable = async (cents: number) => (await createPayable(slot[SERVER_CONTEXT_KEY]!.db, { orgId: ORG, recipientId: alice, kind: "bounty", usdCents: cents, reference: `R5-${++n}` })).id;
type Body = Record<string, unknown> & { items?: { usdCents: number | null; zat: string; memo: string }[]; problems?: { code: string; index?: number }[]; rateLock?: { seq: number; rate: string } | null };
const headers = { host: HOST, origin: `http://${HOST}` };
const make = async (body: unknown, extra: Record<string, string> = {}) => {
  const r = await fromPayables.POST(new Request(`http://${HOST}/api/batches/from-payables`, { method: "POST", headers: { ...headers, "content-type": "application/json", ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) }), undefined);
  return { status: r.status, location: r.headers.get("location"), retry: r.headers.get("retry-after"), body: (await r.json()) as Body };
};
const get = async (id: string) => (await (await item.GET(new Request(`http://${HOST}/api/batches/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) })).json()) as Body;
const relock = async (id: string) => {
  const r = await lockRoute.POST(new Request(`http://${HOST}/api/batches/${id}/rate-lock`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
  return { status: r.status, body: (await r.json()) as Body };
};
const batchCount = () => (slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT count(*) FROM batches").pluck().get() as number);

test("201: the lines converted at the lock returned with them; GET shows each line's cents and rateFixed", async () => {
  answer = { status: 200, body: TICKER("31.41592", "31.50000") };
  const [a, b] = [await payable(2_500), await payable(123_456)];
  const r = await make({ title: "September bounties", payableIds: [a, b] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.location, `/api/batches/${r.body.id}`);
  assert.deepEqual(r.body.items!.map((i) => [i.usdCents, i.zat]), [[2_500, usdCentsToZat(2_500, "31.41592").toString()], [123_456, usdCentsToZat(123_456, "31.41592").toString()]]);
  assert.deepEqual([r.body.rateLock!.seq, r.body.rateLock!.rate, r.body.rateFixed], [1, "31.41592", true]);
  const got = await get(String(r.body.id));
  assert.deepEqual(got, r.body, "GET shows the same batch, lock and cents");
});

test("a re-lock is 409 rate_fixed, and nothing is recorded", async () => {
  const r = await make({ title: "fixed", payableIds: [await payable(5_000)] });
  const before = asked;
  const again = await relock(String(r.body.id));
  assert.deepEqual([again.status, again.body.code], [409, "rate_fixed"]);
  assert.match(String(again.body.detail), /cannot be re-locked; to pay at another rate, void this draft/);
  assert.equal(asked, before, "refused before asking the source");
  assert.deepEqual((await listQuotes(slot[SERVER_CONTEXT_KEY]!.db, ORG, String(r.body.id))).map((q) => q.seq), [1]);
});

test("review H5a round 1, through the API: a hand-made batch cannot carry a payable, and a payable typed by hand first is taken (422 naming the batch); re-locking an unknown batch is 404", async () => {
  const hand = async (memo: string) => {
    const { POST } = await import("../app/api/batches/route.ts");
    const r = await POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ title: `hand ${memo}`, items: [{ payableId: `h-${memo}`, address: UA, zat: "5", memo }] }) }), undefined);
    return { status: r.status, body: (await r.json()) as Body & { id?: string } };
  };
  const typed = await hand("API-INV-1");
  assert.equal(typed.status, 201);
  const ref = await createPayable(slot[SERVER_CONTEXT_KEY]!.db, { orgId: ORG, recipientId: alice, kind: "invoice", usdCents: 100, reference: "API-INV-1" });
  const taken = await make({ title: "late", payableIds: [ref.id] });
  assert.deepEqual([taken.status, taken.body.problems!.map((p) => p.code)], [422, ["payable_taken"]]);
  assert.match(JSON.stringify(taken.body.problems), new RegExp(`already in batch ${typed.body.id}`));
  const p = await payable(200);
  const { body } = await make({ title: "first", payableIds: [p] });
  const reference = body.items![0].memo;
  const again = await hand(reference);
  assert.deepEqual([again.status, again.body.code, again.body.problems!.map((x) => x.code).sort()], [422, "batch_invalid", ["memo_taken", "payable_reserved"]]);
  const missing = await relock("01900000-0000-7000-8000-000000000000");
  assert.deepEqual([missing.status, missing.body.code], [404, "batch_not_found"]);
});

test("400 for the shape: no ids, 51 ids, a missing title, an unknown key (the org), not JSON", async () => {
  for (const body of [{ title: "x", payableIds: [] }, { title: "x", payableIds: Array.from({ length: 51 }, () => "p") }, { payableIds: ["p"] }, { title: "x", payableIds: ["p"], orgId: "other" }, "not json"]) {
    const r = await make(body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test("422 batch_invalid with every problem, checked before the source is asked; nothing created", async () => {
  const taken = await payable(100);
  await make({ title: "first", payableIds: [taken] });
  const free = await payable(200);
  const [before, count] = [asked, batchCount()];
  const r = await make({ title: "", payableIds: [free, free, "01900000-0000-7000-8000-000000000000", taken] });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "batch_invalid");
  assert.deepEqual(r.body.problems!.map((p) => `${p.code}${p.index === undefined ? "" : `@${p.index}`}`).sort(), ["payable_repeated@1", "payable_taken@3", "payable_unknown@2", "title_invalid"]);
  assert.equal(asked, before, "no quote spent");
  answer = { status: 200, body: TICKER("2000000", "2000001") };
  const cent = await make({ title: "a cent", payableIds: [await payable(1)] });
  assert.deepEqual([cent.status, cent.body.problems!.map((p) => p.code)], [422, ["amount_out_of_range"]], "the conversion's own problem");
  answer = { status: 200, body: TICKER("31.41592", "31.50000") };
  assert.equal(batchCount(), count);
});

test("502 rate_unavailable when the source fails: nothing created, the payable still free", async () => {
  const p = await payable(700);
  const count = batchCount();
  answer = { status: 503, body: "down" };
  const r = await make({ title: "down", payableIds: [p] });
  assert.deepEqual([r.status, r.body.code, r.body.reason], [502, "rate_unavailable", "http"]);
  assert.equal(batchCount(), count);
  answer = { status: 200, body: TICKER("31.41592", "31.50000") };
  assert.equal((await make({ title: "up", payableIds: [p] })).status, 201, "the payable was never taken");
});

test("the guard refuses a cross-site post; 503 store_busy under a held write lock, nothing created", async () => {
  assert.equal((await make({ title: "x", payableIds: [await payable(1_000)] }, { origin: "https://evil.example" })).status, 403);
  const p = await payable(1_100);
  const count = batchCount();
  const other = new Database(DB);
  other.exec("BEGIN IMMEDIATE");
  try {
    const r = await make({ title: "blocked", payableIds: [p] });
    assert.deepEqual([r.status, r.body.code, r.retry], [503, "store_busy", "1"]);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.equal(batchCount(), count);
});
