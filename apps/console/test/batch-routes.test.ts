// Batch routes that move no money (slice D1), called through the real route exports against a booted context on a
// temporary database: create (201, Location), validation (422 every problem, 400 paths without values),
// tenant and network from config, list with exact totals above 2^53, 404s, 503 before boot, fixed 500.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import type { BatchJson, BatchSummaryJson } from "../lib/http/batches.ts";
import * as collection from "../app/api/batches/route.ts";
import * as item from "../app/api/batches/[id]/route.ts";
import type { ProblemJson } from "../lib/http/problem.ts";
import { longUa } from "./helpers/ua-encoder.ts";

const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-routes-"));
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://${HOST}/api/batches`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
// The real route exports (guard + handler + problem mapping), called as Next would call them.
const handleCreate = (req: Request) => collection.POST(req, undefined);
const handleList = () => collection.GET(new Request(`http://${HOST}/api/batches`, { headers: { host: HOST } }), undefined);
const handleGet = (id: string) => item.GET(new Request(`http://${HOST}/api/batches/${encodeURIComponent(id)}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) });
const draft = (over: Record<string, unknown> = {}) => ({
  title: "September contributors",
  items: [
    { payableId: "inv-1", label: "Alice", address: R[0], zat: "150000000", memo: "INV-1" },
    { payableId: "inv-2", address: R[1], zat: "2500", memo: "INV-2" },
  ],
  ...over,
});
/** One response body type per test: a batch, a list, or a problem (all fields optional so each assertion names what it needs). */
type Body = Partial<BatchJson> & Partial<ProblemJson> & { batches?: BatchSummaryJson[] };
const read = async (r: Response) => ({ status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), location: r.headers.get("location"), body: (await r.json()) as Body });

before(() => {
  delete slot[SERVER_CONTEXT_KEY];
});
after(() => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

test("before boot every route answers 503 not_ready (fail closed)", async () => {
  for (const r of [await handleList(), await handleGet("x"), await handleCreate(post(draft()))]) {
    const x = await read(r);
    assert.deepEqual([x.status, x.body.code, x.type], [503, "not_ready", "application/problem+json"]);
  }
});

test("create: 201 with Location; zat as strings; org and network from the deployment's config", async () => {
  bootServerContext(
    {
      ZECEIPT_CUSTODY_MODE: "hot",
      ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql",
      ZECEIPT_ZKOOL_ACCOUNT: "1",
      ZECEIPT_DB_PATH: join(dir, "routes.db"),
      ZECEIPT_ORG_ID: "demo-org",
      ZECEIPT_NETWORK: "regtest",
      ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
      ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
      ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
      ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
      ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
      ZECEIPT_ISSUER_KEY_ID: "2026-09",
    },
    { migrationsFolder: defaultMigrationsDir() },
  );
  const x = await read(await handleCreate(post(draft())));
  assert.equal(x.status, 201);
  assert.equal(x.type, "application/json");
  assert.equal(x.cache, "no-store");
  assert.match(x.body.id!, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(x.location, `/api/batches/${x.body.id}`);
  assert.equal(x.body.network, "regtest");
  assert.equal(x.body.totalZat, "150002500");
  assert.deepEqual(x.body.items, [
    { idx: 0, payableId: "inv-1", label: "Alice", address: R[0], zat: "150000000", memo: "INV-1", usdCents: null },
    { idx: 1, payableId: "inv-2", label: "", address: R[1], zat: "2500", memo: "INV-2", usdCents: null },
  ]);
  assert.equal(x.body.rateFixed, false, "a hand-made batch can be locked and re-locked (slice H5a)");
  assert.equal(slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT org_id FROM batches WHERE id = ?").pluck().get(x.body.id!), "demo-org");

  const got = await read(await handleGet(x.body.id!));
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, x.body);
});

test("422: every domain problem, with item indexes; nothing written", async () => {
  const before = (await read(await handleList())).body.batches!.length;
  const bad = draft({
    title: "",
    items: [
      { payableId: "p", address: R[0].replace("uregtest1", "utest1"), zat: "0", memo: "M" },
      { payableId: "p", address: R[1], zat: "2100000000000001", memo: "M" },
    ],
  });
  const x = await read(await handleCreate(post(bad)));
  assert.equal(x.status, 422);
  assert.equal(x.body.code, "batch_invalid");
  const codes = x.body.problems!.map((p) => `${p.code}@${p.index ?? "-"}`).sort();
  for (const c of ["title_invalid@-", "amount_nonpositive@0", "amount_too_large@1", "duplicate_payable@1", "memo_duplicate@1"]) assert.ok(codes.includes(c), `${c} in ${codes}`);
  assert.ok(codes.some((c) => c.endsWith("@0") && c !== "amount_nonpositive@0"), `an address problem for item 0 in ${codes}`);
  assert.equal((await read(await handleList())).body.batches!.length, before);
});

test("422 batch_invalid for an item address longer than the console stores, not a 500 (review H1 round 2); nothing written", async () => {
  const before = (await read(await handleList())).body.batches!.length;
  const x = await read(await handleCreate(post(draft({ items: [{ payableId: "inv-long", address: longUa(), zat: "1", memo: "LONG" }] }))));
  assert.equal(x.status, 422);
  assert.equal(x.body.code, "batch_invalid");
  assert.deepEqual(x.body.problems!.map((p) => `${p.code}@${p.index}`), ["address_malformed@0"]);
  assert.equal((await read(await handleList())).body.batches!.length, before);
});

test("400: schema problems give paths and zod messages, never the submitted values; tenant fields are refused", async () => {
  const secretish = "SHOULD-NOT-ECHO-12345";
  const x = await read(
    await handleCreate(
      post({
        title: 7,
        orgId: secretish,
        network: "main",
        items: [{ payableId: "p", address: R[0], zat: 150000000, memo: "M", extra: secretish }, { payableId: "q", address: R[0], zat: "-5", memo: "N" }],
      }),
    ),
  );
  assert.equal(x.status, 400);
  assert.equal(x.body.code, "body_invalid");
  const paths = x.body.issues!.map((i) => i.path).sort();
  assert.deepEqual(paths, ["", "items.0", "items.0.zat", "items.1.zat", "title"]);
  assert.ok(!JSON.stringify(x.body).includes(secretish));
  assert.ok(!JSON.stringify(x.body).includes("150000000"));
  // A JSON number above 2^53 would already be rounded; only digit strings are accepted.
  assert.equal((await read(await handleCreate(post('{"title":"t","items":[{"payableId":"p","address":"a","zat":9007199254740993,"memo":"m"}]}')))).status, 400);
  assert.equal((await read(await handleCreate(post(draft({ items: [] }))))).status, 400);
  assert.equal((await read(await handleCreate(post(draft({ items: Array.from({ length: 51 }, (_, i) => ({ payableId: `p${i}`, address: R[0], zat: "1", memo: `m${i}` })) }))))).status, 400);
});

test("the route applies the guard itself (API routes are outside proxy.ts), and body limits apply", async () => {
  assert.equal((await read(await handleCreate(post(draft(), { origin: "http://evil.example" })))).body.code, "origin_mismatch");
  assert.equal((await read(await handleCreate(post(draft(), { host: "evil.example" })))).body.code, "host_not_allowed");
  assert.equal((await read(await handleCreate(post(draft(), { "content-type": "text/plain" })))).status, 415);
  assert.equal((await read(await handleCreate(post("{")))).body.code, "malformed_json");
});

test("list: newest first; totals are exact decimal strings above 2^53", async () => {
  const big = await read(
    await handleCreate(post(draft({ title: "big", items: [0, 1, 2, 3, 4].map((i) => ({ payableId: `b${i}`, address: R[i % 2], zat: "2100000000000000", memo: `B${i}` })) }))),
  );
  assert.equal(big.status, 201);
  assert.equal(big.body.totalZat, "10500000000000000");
  assert.ok(10500000000000000 > Number.MAX_SAFE_INTEGER);
  const list = (await read(await handleList())).body.batches!;
  assert.equal(list[0].id, big.body.id);
  assert.deepEqual(list[0], { id: big.body.id, network: "regtest", title: "big", createdAt: big.body.createdAt, itemCount: 5, totalZat: "10500000000000000" });
});

test("404: unknown id, non-UUIDv7 text, and path tricks never reach the database as ids", async () => {
  for (const id of ["0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f", "nope", "", "../../etc", "0190A0D6-7E3B-7C61-8D3F-4A2B1C0D9E8F", "0190a0d6-7e3b-4c61-8d3f-4a2b1c0d9e8f"]) {
    const x = await read(await handleGet(id));
    assert.deepEqual([x.status, x.body.code, x.type], [404, "batch_not_found", "application/problem+json"], id);
  }
});

test("500: an unexpected failure is a fixed problem, never the error text", async () => {
  slot[SERVER_CONTEXT_KEY]!.db.$client.close();
  const x = await read(await handleList());
  assert.deepEqual([x.status, x.body.code, x.body.detail], [500, "internal", "the console could not complete this request"]);
  assert.ok(!JSON.stringify(x.body).match(/database|sqlite|open/i));
});
