// Payable routes (slice H3; REQ-CON-3) through the real route exports on a booted context: 201 with Location; 400
// for types and shape (a missing reference, a string amount, an unknown kind or key, an org named in the body); 422
// with every value problem; 409 when the reference is taken; 404; the guard's 403; 503 under a held write lock.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, createRecipient, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import * as collection from "../app/api/payables/route.ts";
import * as item from "../app/api/payables/[id]/route.ts";

const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-payable-routes-"));
const DB = join(dir, "console.db");
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
let alice: string;

before(async () => {
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: DB, ZECEIPT_ORG_ID: "org-pr", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 5).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09",
  }, { migrationsFolder: defaultMigrationsDir() });
  alice = (await createRecipient(slot[SERVER_CONTEXT_KEY]!.db, { orgId: "org-pr", network: "regtest", displayName: "Alice", address: UA })).id;
});
after(() => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

type Body = Record<string, unknown> & { problems?: { code: string; field: string }[]; issues?: { path: string }[] };
const create = async (body: unknown, headers: Record<string, string> = {}) => {
  const r = await collection.POST(new Request(`http://${HOST}/api/payables`, { method: "POST", headers: { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), undefined);
  return { status: r.status, location: r.headers.get("location"), cache: r.headers.get("cache-control"), retry: r.headers.get("retry-after"), body: (await r.json()) as Body };
};
const list = async () => (await (await collection.GET(new Request(`http://${HOST}/api/payables`, { headers: { host: HOST } }), undefined)).json()) as { payables: Body[] };
const get = async (id: string) => {
  const r = await item.GET(new Request(`http://${HOST}/api/payables/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) });
  return { status: r.status, body: (await r.json()) as Body };
};
const valid = (over: Record<string, unknown> = {}) => ({ recipientId: alice, kind: "bounty", usdCents: 25_000, reference: "BOUNTY-17", sourceUrl: "https://github.com/org/repo/issues/17", ...over });

test("REQ-CON-3: 201 with Location and every field; GET by id and the list read it back", async () => {
  const r = await create(valid());
  assert.equal(r.status, 201);
  assert.equal(r.cache, "no-store");
  assert.equal(r.location, `/api/payables/${r.body.id}`);
  assert.deepEqual({ ...r.body, id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined, recipientId: alice, kind: "bounty", usdCents: 25_000, reference: "BOUNTY-17", sourceUrl: "https://github.com/org/repo/issues/17" });
  assert.deepEqual((await get(String(r.body.id))).body, r.body);
  assert.deepEqual((await list()).payables[0], r.body, "newest first");
  const bare = await create(valid({ reference: "SALARY-SEP", kind: "salary", sourceUrl: undefined }));
  assert.deepEqual([bare.status, bare.body.sourceUrl], [201, null]);
});

test("REQ-CON-3: a missing reference, a string amount, an unknown kind or key, or an org in the body is 400 body_invalid with the path", async () => {
  const noReference: Record<string, unknown> = valid();
  delete noReference.reference;
  for (const [body, path] of [
    [noReference, "reference"], [valid({ usdCents: "250.00" }), "usdCents"], [valid({ kind: "gift" }), "kind"],
    [valid({ orgId: "other" }), ""], [valid({ status: "paid" }), ""], [valid({ recipientId: 7 }), "recipientId"],
  ] as const) {
    const r = await create(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, "body_invalid");
    assert.ok(r.body.issues!.some((i) => i.path === path), `${path} in ${JSON.stringify(r.body.issues)}`);
  }
  assert.equal((await create("not json")).status, 400);
});

test("REQ-CON-3: invalid values are 422 payable_invalid with every problem and its field; nothing saved", async () => {
  const before = (await list()).payables.length;
  const r = await create(valid({ recipientId: "01900000-0000-7000-8000-000000000000", usdCents: 12.5, reference: " ", sourceUrl: "javascript:alert(1)" }));
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "payable_invalid");
  assert.deepEqual(r.body.problems!.map((p) => [p.code, p.field]).sort(), [["recipient_unknown", "recipientId"], ["reference_invalid", "reference"], ["source_invalid", "sourceUrl"], ["usd_invalid", "usdCents"]]);
  for (const usdCents of [0, 100_000_000]) assert.equal((await create(valid({ reference: `U-${usdCents}`, usdCents }))).status, 422, String(usdCents));
  assert.equal((await list()).payables.length, before);
});

test("a reference already used in the org is 409 reference_taken, naming the payable that holds it; nothing saved", async () => {
  const first = await create(valid({ reference: "INV-2026-09" }));
  const before = (await list()).payables.length;
  const again = await create(valid({ reference: "INV-2026-09", usdCents: 1 }));
  assert.deepEqual([again.status, again.body.code, again.body.payableId], [409, "reference_taken", first.body.id]);
  assert.equal((await list()).payables.length, before);
});

test("404 for an unknown or malformed id; the guard refuses a cross-site post", async () => {
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) {
    const r = await get(id);
    assert.deepEqual([r.status, r.body.code], [404, "payable_not_found"]);
  }
  assert.equal((await create(valid({ reference: "CROSS" }), { origin: "https://evil.example" })).status, 403);
});

test("503 store_busy with Retry-After while another process holds the write lock; nothing saved", async () => {
  const other = new Database(DB);
  other.exec("BEGIN IMMEDIATE");
  try {
    const r = await create(valid({ reference: "BLOCKED" }));
    assert.deepEqual([r.status, r.body.code, r.retry], [503, "store_busy", "1"]);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.ok(!(await list()).payables.some((p) => p.reference === "BLOCKED"));
});
