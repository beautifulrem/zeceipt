// Recipient routes (slice H1; REQ-CON-2) through the real route exports on a booted context: 201 with Location,
// duplicates flagged not blocked, 400 for a malformed body (including a network or org named in it), 422 with every
// problem, 404, the guard's 403, and 503 when another process holds the database's write lock.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import * as collection from "../app/api/recipients/route.ts";
import * as item from "../app/api/recipients/[id]/route.ts";
import { longUa } from "./helpers/ua-encoder.ts";

const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-recipient-routes-"));
const DB = join(dir, "console.db");
const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
const MAINNET = "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel";

before(() => {
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: DB, ZECEIPT_ORG_ID: "org-rr", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 5).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09",
  }, { migrationsFolder: defaultMigrationsDir() });
});
after(() => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

type Body = Record<string, unknown> & { problems?: { code: string; field: string }[]; duplicateOf?: string[] };
const create = async (body: unknown, headers: Record<string, string> = {}) => {
  const r = await collection.POST(new Request(`http://${HOST}/api/recipients`, { method: "POST", headers: { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), undefined);
  return { status: r.status, location: r.headers.get("location"), cache: r.headers.get("cache-control"), retry: r.headers.get("retry-after"), body: (await r.json()) as Body };
};
const list = async () => (await (await collection.GET(new Request(`http://${HOST}/api/recipients`, { headers: { host: HOST } }), undefined)).json()) as { recipients: Body[] };
const get = async (id: string) => {
  const r = await item.GET(new Request(`http://${HOST}/api/recipients/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) });
  return { status: r.status, body: (await r.json()) as Body };
};

test("201 with Location and the recipient; the network is the console's; GET reads it back", async () => {
  const r = await create({ displayName: "Alice", address: R[0], kycStatus: "verified", taxFlag: "non_us" });
  assert.equal(r.status, 201);
  assert.equal(r.cache, "no-store");
  assert.equal(r.location, `/api/recipients/${r.body.id}`);
  assert.deepEqual([r.body.network, r.body.kycStatus, r.body.taxFlag, r.body.settlementPref, r.body.duplicateOf], ["regtest", "verified", "non_us", "zec", []]);
  assert.deepEqual((await get(String(r.body.id))).body, r.body);
});

test("REQ-CON-2: a duplicate address is created and flagged (duplicateOf), on create, list and get", async () => {
  const a = await create({ displayName: "Ops wallet", address: R[1] });
  const b = await create({ displayName: "Grants wallet", address: R[1].toUpperCase() });
  assert.equal(b.status, 201, "flagged, not blocked");
  assert.deepEqual(b.body.duplicateOf, [a.body.id]);
  const byId = Object.fromEntries((await list()).recipients.map((x) => [x.id, x.duplicateOf]));
  assert.deepEqual([byId[String(a.body.id)], byId[String(b.body.id)]], [[b.body.id], [a.body.id]]);
});

test("REQ-CON-2: an invalid address is 422 recipient_invalid, with every problem and its field; nothing saved", async () => {
  const before = (await list()).recipients.length;
  const r = await create({ displayName: "", address: MAINNET, notes: "x".repeat(1001) });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "recipient_invalid");
  assert.deepEqual(r.body.problems!.map((p) => [p.code, p.field]).sort(), [["address_hrp", "address"], ["name_invalid", "displayName"], ["notes_invalid", "notes"]]);
  assert.equal((await list()).recipients.length, before);
});

test("an address longer than the console stores is 422 address_malformed, not a 500 (review H1 round 2); nothing saved", async () => {
  const before = (await list()).recipients.length;
  const r = await create({ displayName: "Long", address: longUa() });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "recipient_invalid");
  assert.deepEqual(r.body.problems!.map((p) => [p.code, p.field]), [["address_malformed", "address"]]);
  assert.equal((await list()).recipients.length, before);
});

test("slice H7: a display name with invisible characters is 422 name_invalid on displayName; nothing saved", async () => {
  const before = (await list()).recipients.length;
  const r = await create({ displayName: "Ali\u200bce", address: R[0] });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.problems!.map((p) => [p.code, p.field]), [["name_invalid", "displayName"]]);
  assert.equal((await list()).recipients.length, before);
});

test("a malformed body is 400 body_invalid: wrong types, unknown enum values, and a network or org named in the body", async () => {
  for (const body of [{ displayName: "x" }, { displayName: "x", address: R[0], kycStatus: "maybe" }, { displayName: "x", address: R[0], network: "main" }, { displayName: "x", address: R[0], orgId: "other" }, "not json"]) {
    const r = await create(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test("404 for an unknown or malformed id; the guard refuses a cross-site post", async () => {
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) assert.deepEqual([(await get(id)).status, (await get(id)).body.code], [404, "recipient_not_found"]);
  assert.equal((await create({ displayName: "x", address: R[0] }, { origin: "https://evil.example" })).status, 403);
});

test("503 store_busy with Retry-After while another process holds the write lock; nothing saved", async () => {
  const other = new Database(DB);
  other.exec("BEGIN IMMEDIATE");
  try {
    const r = await create({ displayName: "Blocked", address: R[0] });
    assert.deepEqual([r.status, r.body.code, r.retry], [503, "store_busy", "1"]);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.ok(!(await list()).recipients.some((x) => x.displayName === "Blocked"));
});
