// POST /api/batches/{id}/approve (slice I3; design I3.4.2–3) through the real route exports, and the payment's
// approval guard: 201 then an idempotent 200; every refusal in the documented order (nothing approved); submit without
// a valid approval is 409 not_approved, sent_nothing, with no pay call; approve, then pay. A fake Zkool pays; a local
// fake of Kraken's Ticker supplies the locks.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import { approvalsProblem } from "../lib/http/approvals.ts";
import * as collection from "../app/api/batches/route.ts";
import * as approveRoute from "../app/api/batches/[id]/approve/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";
import * as statusRoute from "../app/api/batches/[id]/status/route.ts";
import * as submitRoute from "../app/api/batches/[id]/submit/route.ts";
import * as voidRoute from "../app/api/batches/[id]/void/route.ts";
import { approveRequest } from "./helpers/approve.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { ZKOOL_PUBLIC_PEM, zkoolTokenFile } from "./helpers/zkool-token.ts";

const HOST = "127.0.0.1:3000";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-approve-routes-"));
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const ticker = JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1601.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } });
const source = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(ticker));
let fake: FakeZkool;
let sourceUrl = "";

function boot(extra: Record<string, string | undefined> = {}) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  const env: Record<string, string | undefined> = {
    ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_DB_PATH: join(dir, "console.db"), ZECEIPT_ORG_ID: "demo-org", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
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

type Body = Record<string, unknown> & { id?: string; code?: string; thisRequest?: string; lockSeq?: number; state?: string; next?: string; approval?: { seq: number; approvedAt: string; lockSeq: number; approver: string } };
const json = async (r: Response) => ({ status: r.status, headers: r.headers, body: (await r.json()) as Body });
let n = 0;
const draft = async () => {
  n++;
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: `ap${n}`, items: [{ payableId: `ap-${n}`, address: UA, zat: "1000", memo: `AP-${n}` }] }) }), undefined);
  assert.equal(r.status, 201);
  return ((await r.json()) as { id: string }).id;
};
const lock = async (id: string) => json(await lockRoute.POST(new Request(`http://${HOST}/api/batches/${id}/rate-lock`, { method: "POST", headers }), params(id)));
const approveIt = async (id: string, body?: unknown) => json(await approveRequest(id, body));
const submit = async (id: string) => json(await submitRoute.POST(new Request(`http://${HOST}/api/batches/${id}/submit`, { method: "POST", headers, body: JSON.stringify({ confirmTotalZat: "1000" }) }), params(id)));
const status = async (id: string) => json(await statusRoute.GET(new Request(`http://${HOST}/api/batches/${id}/status`, { headers: { host: HOST } }), params(id)));
const approvalRows = (id: string) => slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT count(*) FROM approvals WHERE batch_id = ?").pluck().get(id) as number;

test("201 with the approval, then an idempotent 200 with the same one; the status becomes approved / submit", async () => {
  const id = await draft();
  assert.equal((await lock(id)).status, 201);
  assert.deepEqual([(await status(id)).body.state, (await status(id)).body.next], ["draft", "approve"]);
  const first = await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 });
  assert.equal(first.status, 201);
  assert.deepEqual({ ...first.body.approval, approvedAt: "t" }, { seq: 1, approvedAt: "t", lockSeq: 1, approver: "operator" });
  assert.match(String(first.body.approval?.approvedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual([first.body.batchId, first.headers.get("location"), first.headers.get("cache-control")], [id, `/api/batches/${id}/status`, "no-store"]);
  const again = await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 });
  assert.deepEqual([again.status, again.body.approval], [200, first.body.approval]);
  assert.equal(approvalRows(id), 1, "no second row");
  assert.deepEqual([(await status(id)).body.state, (await status(id)).body.next], ["approved", "submit"]);
});

test("refusals, nothing approved: body_invalid, confirmation_mismatch, approval_stale (with the current lockSeq), rate_not_locked", async () => {
  const id = await draft();
  assert.deepEqual([(await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 })).status, (await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 })).body.code], [409, "rate_not_locked"]);
  await lock(id);
  for (const body of [{}, { confirmTotalZat: "1000" }, { confirmTotalZat: "1000", lockSeq: "1" }, { confirmTotalZat: "1000", lockSeq: 0 }, { confirmTotalZat: "1000", lockSeq: 1.5 }, { confirmTotalZat: 1000, lockSeq: 1 }, { confirmTotalZat: "1000", lockSeq: 1, extra: 1 }]) {
    const r = await approveIt(id, body);
    assert.deepEqual([r.status, r.body.code], [400, "body_invalid"], JSON.stringify(body));
  }
  assert.deepEqual([(await approveIt(id, "{")).status, (await approveIt(id, "{")).body.code], [400, "malformed_json"]);
  const wrong = await approveIt(id, { confirmTotalZat: "999", lockSeq: 1 });
  assert.deepEqual([wrong.status, wrong.body.code], [422, "confirmation_mismatch"]);
  await lock(id); // re-locked after the approver's page was drawn
  const stale = await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 });
  assert.deepEqual([stale.status, stale.body.code, stale.body.lockSeq], [409, "approval_stale", 2]);
  assert.equal(approvalRows(id), 0, "nothing approved by any refusal");
  assert.equal((await approveIt(id, { confirmTotalZat: "1000", lockSeq: 2 })).status, 201);
});

test("404 (unknown or malformed id), 409 batch_voided, 409 batch_frozen, the guard's 403", async () => {
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) {
    const r = await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 });
    assert.deepEqual([r.status, r.body.code], [404, "batch_not_found"]);
  }
  const v = await draft();
  await lock(v);
  assert.equal((await voidRoute.POST(new Request(`http://${HOST}/api/batches/${v}/void`, { method: "POST", headers }), params(v))).status, 200);
  const voided = await approveIt(v, { confirmTotalZat: "1000", lockSeq: 1 });
  assert.deepEqual([voided.status, voided.body.code], [409, "batch_voided"]);

  const paid = await draft();
  await lock(paid);
  assert.equal((await approveIt(paid)).status, 201);
  assert.equal((await submit(paid)).status, 202);
  const frozen = await approveIt(paid, { confirmTotalZat: "1000", lockSeq: 1 });
  assert.deepEqual([frozen.status, frozen.body.code], [409, "batch_frozen"]);

  const cross = await draft();
  const r = await approveRoute.POST(new Request(`http://${HOST}/api/batches/${cross}/approve`, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: "{}" }), params(cross));
  assert.equal(r.status, 403);
});

test("submit without a valid approval: 409 not_approved, sent_nothing, no pay call; approve, then it pays", async () => {
  const id = await draft();
  await lock(id);
  const calls = fake.payCalls;
  const refused = await submit(id);
  assert.deepEqual([refused.status, refused.body.code, refused.body.thisRequest], [409, "not_approved", "sent_nothing"]);
  assert.equal(fake.payCalls, calls, "the wallet was never asked to pay");
  assert.deepEqual([(await status(id)).body.state, (await status(id)).body.next], ["draft", "approve"], "the refusal recorded no attempt");
  assert.equal((await approveIt(id)).status, 201);
  const paid = await submit(id);
  assert.equal(paid.status, 202, JSON.stringify(paid.body));
  assert.equal(fake.payCalls, calls + 1);
});

test("no lock: submit still says rate_not_locked first (locking comes before approving)", async () => {
  const id = await draft();
  const r = await submit(id);
  assert.deepEqual([r.status, r.body.code, r.body.thisRequest], [409, "rate_not_locked", "sent_nothing"]);
});

test("503 store_busy with Retry-After while another process holds the write lock; nothing approved", async () => {
  const id = await draft();
  await lock(id);
  const other = new Database(join(dir, "console.db"));
  other.exec("BEGIN IMMEDIATE");
  try {
    const r = await approveIt(id);
    assert.deepEqual([r.status, r.body.code, r.headers.get("retry-after")], [503, "store_busy", "1"]);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.equal(approvalRows(id), 0);
});

test("the triggers' refusals, raced past the route's checks, are mapped by code (E1)", async () => {
  for (const [code, status] of [["batch_voided", 409], ["batch_frozen", 409], ["store_busy", 503]] as const) {
    const r = approvalsProblem(Object.assign(new Error("raced"), { code }));
    assert.deepEqual([r?.status, ((await r!.json()) as { code: string }).code], [status, code]);
  }
  assert.equal(approvalsProblem(new Error("other")), undefined, "anything else is the fixed 500");
});

test("external custody: 409 custody_external (this console never pays, so it takes no approvals)", async () => {
  boot({ ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_DB_PATH: join(dir, "external.db") });
  try {
    const id = await draft();
    const r = await approveIt(id, { confirmTotalZat: "1000", lockSeq: 1 });
    assert.deepEqual([r.status, r.body.code], [409, "custody_external"]);
  } finally {
    boot();
  }
});

test("not ready: 503 not_ready before boot", async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  try {
    const r = await approveIt("01900000-0000-7000-8000-000000000000", { confirmTotalZat: "1000", lockSeq: 1 });
    assert.deepEqual([r.status, r.body.code], [503, "not_ready"]);
  } finally {
    boot();
  }
});
