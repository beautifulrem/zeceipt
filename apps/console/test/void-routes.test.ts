// POST /api/batches/{id}/void (slice H5c) through the real route exports, and the recovery it exists for (AC3): a
// batch from payables whose rate moved is refused by the guard (409 rate_moved, sent nothing), voided, made again from
// the same payables at the new rate, and paid. A fake Zkool pays; a local fake of Kraken's Ticker moves the rate.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, createPayable, createRecipient, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import * as fromPayables from "../app/api/batches/from-payables/route.ts";
import * as collection from "../app/api/batches/route.ts";
import * as item from "../app/api/batches/[id]/route.ts";
import * as submitRoute from "../app/api/batches/[id]/submit/route.ts";
import * as statusRoute from "../app/api/batches/[id]/status/route.ts";
import * as voidRoute from "../app/api/batches/[id]/void/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";
import { approve } from "./helpers/approve.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { submitProblem } from "../lib/http/submit.ts";
import { ZKOOL_PUBLIC_PEM, zkoolPublicKeyFile, zkoolTokenFile } from "./helpers/zkool-token.ts";

const HOST = "127.0.0.1:3000";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-void-routes-"));
const DB = join(dir, "console.db");
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const ticker = (bid: string) => JSON.stringify({ error: [], result: { XZECZUSD: { a: [bid, "1", "1"], b: [bid, "1", "1"], c: [bid, "0.1"] } } });
let tick = ticker("1600.00");
const source = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(tick));
let fake: FakeZkool;
let alice: string;

before(async () => {
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(), ZECEIPT_DB_PATH: DB, ZECEIPT_ORG_ID: "demo-org", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
  }, { migrationsFolder: defaultMigrationsDir() });
  alice = (await createRecipient(slot[SERVER_CONTEXT_KEY]!.db, { orgId: "demo-org", network: "regtest", displayName: "Alice", address: UA })).id;
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
  await new Promise((r) => source.close(r));
});

type Body = Record<string, unknown> & { id?: string; code?: string; voided?: { at: string } | null; items?: { zat: string }[]; totalZat?: string; state?: string; thisRequest?: string; txid?: string };
const json = async (r: Response) => ({ status: r.status, retry: r.headers.get("retry-after"), body: (await r.json()) as Body });
const voidIt = async (id: string, extra: Record<string, string> = {}) => json(await voidRoute.POST(new Request(`http://${HOST}/api/batches/${id}/void`, { method: "POST", headers: { ...headers, ...extra } }), params(id)));
const get = async (id: string) => json(await item.GET(new Request(`http://${HOST}/api/batches/${id}`, { headers: { host: HOST } }), params(id)));
const status = async (id: string) => json(await statusRoute.GET(new Request(`http://${HOST}/api/batches/${id}/status`, { headers: { host: HOST } }), params(id)));
const submit = async (id: string, total: string) => json(await submitRoute.POST(new Request(`http://${HOST}/api/batches/${id}/submit`, { method: "POST", headers, body: JSON.stringify({ confirmTotalZat: total }) }), params(id)));
const hand = async (memo: string) => json(await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: memo, items: [{ payableId: `h-${memo}`, address: UA, zat: "1000", memo }] }) }), undefined));
const fromIds = async (title: string, payableIds: string[]) => json(await fromPayables.POST(new Request(`http://${HOST}/api/batches/from-payables`, { method: "POST", headers, body: JSON.stringify({ title, payableIds }) }), undefined));

test("200 with the voided batch; GET and the status say voided; 409 batch_voided the second time; 404; the guard's 403", async () => {
  const b = await hand("VOID-ME");
  const v = await voidIt(b.body.id!);
  assert.equal(v.status, 200);
  assert.match(String(v.body.voided?.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual((await get(b.body.id!)).body, v.body);
  assert.deepEqual([(await status(b.body.id!)).body.state, (await status(b.body.id!)).body.next], ["voided", "none"]);
  assert.deepEqual([(await voidIt(b.body.id!)).status, (await voidIt(b.body.id!)).body.code], [409, "batch_voided"]);
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) assert.deepEqual([(await voidIt(id)).status, (await voidIt(id)).body.code], [404, "batch_not_found"]);
  assert.equal((await voidIt((await hand("CROSS")).body.id!, { origin: "https://evil.example" })).status, 403);
  assert.equal((await hand("VOID-ME")).status, 201, "its memo is free again");
});

test("409 batch_frozen once an attempt may have sent the batch; nothing changed", async () => {
  tick = ticker("1600.00");
  const b = await hand("PAID-ONE");
  assert.equal((await lockRoute.POST(new Request(`http://${HOST}/api/batches/${b.body.id}/rate-lock`, { method: "POST", headers }), params(b.body.id!))).status, 201, "locked (submit needs a lock)");
  await approve(b.body.id!);
  const paid = await submit(b.body.id!, "1000");
  assert.equal(paid.status, 202, JSON.stringify(paid.body));
  const v = await voidIt(b.body.id!);
  assert.deepEqual([v.status, v.body.code], [409, "batch_frozen"]);
  assert.equal((await get(b.body.id!)).body.voided, null);
});

test("AC3, the recovery path: a batch from payables whose rate moved is refused, voided, made again at the new rate, and paid", async () => {
  tick = ticker("1600.00");
  const p = (await createPayable(slot[SERVER_CONTEXT_KEY]!.db, { orgId: "demo-org", recipientId: alice, kind: "invoice", usdCents: 160_000, reference: "RECOVER-1" })).id;
  const first = await fromIds("At 1600", [p]);
  assert.equal(first.status, 201);
  tick = ticker("1700.00"); // +6.25%: beyond the 3% limit
  const calls = fake.payCalls;
  await approve(first.body.id!);
  const refused = await submit(first.body.id!, first.body.totalZat!);
  assert.deepEqual([refused.status, refused.body.code, refused.body.thisRequest], [409, "rate_moved", "sent_nothing"]);
  assert.equal(fake.payCalls, calls, "nothing paid");
  assert.equal((await fromIds("Too early", [p])).body.problems ? "taken" : "free", "taken", "the payable is still held before the void");
  const v = await voidIt(first.body.id!);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const second = await fromIds("At 1700", [p]);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.items![0].zat, "94117647", "$1,600.00 at 1700 USD/ZEC");
  await approve(second.body.id!);
  const paid = await submit(second.body.id!, second.body.totalZat!);
  assert.equal(paid.status, 202, JSON.stringify(paid.body));
  assert.equal(fake.payCalls, calls + 1, "paid once, from the new batch");
  assert.deepEqual((await status(first.body.id!)).body.state, "voided");
});

test("review H5c round 1: a voided batch refuses Lock and Pay with 409 batch_voided, sending nothing (never a 500)", async () => {
  tick = ticker("1600.00");
  const lock = async (id: string) => json(await lockRoute.POST(new Request(`http://${HOST}/api/batches/${id}/rate-lock`, { method: "POST", headers }), params(id)));
  const quotes = (id: string) => slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT count(*) FROM rate_quotes WHERE batch_id = ?").pluck().get(id) as number;
  // Locked, then voided: the reviewer's probe (both answered 500).
  const a = await hand("VOIDED-LOCKED");
  assert.equal((await lock(a.body.id!)).status, 201);
  assert.equal((await voidIt(a.body.id!)).status, 200);
  const calls = fake.payCalls;
  const relock = await lock(a.body.id!);
  assert.deepEqual([relock.status, relock.body.code, quotes(a.body.id!)], [409, "batch_voided", 1], "refused before quoting");
  const pay = await submit(a.body.id!, "1000");
  assert.deepEqual([pay.status, pay.body.code, pay.body.thisRequest], [409, "batch_voided", "sent_nothing"]);
  // A refused attempt, then voided: submit took retry() into the trigger and answered 500 "may_have_sent" (my own probe).
  const b = await hand("VOIDED-RETRY");
  assert.equal((await lock(b.body.id!)).status, 201);
  await approve(b.body.id!);
  fake.nextPay = "refused";
  assert.equal((await submit(b.body.id!, "1000")).body.code, "payment_rejected");
  assert.equal((await voidIt(b.body.id!)).status, 200);
  const retry = await submit(b.body.id!, "1000");
  assert.deepEqual([retry.status, retry.body.code, retry.body.thisRequest], [409, "batch_voided", "sent_nothing"]);
  assert.equal(fake.payCalls, calls + 1, "only the refused attempt ever reached the wallet");
});

test("the race: a void that lands mid-submit is refused by the triggers before any pay, and said as sent_nothing", async () => {
  const status = "/api/batches/x/status";
  for (const e of [new Error("batch is voided: final"), Object.assign(new Error("the batch is voided: its rate can no longer be locked"), { code: "batch_voided" }), new Error("wrapped", { cause: new Error("batch is voided: final") })]) {
    const r = submitProblem(e, true, status).response;
    const body = (await r.json()) as { code: string; thisRequest: string };
    assert.deepEqual([r.status, body.code, body.thisRequest], [409, "batch_voided", "sent_nothing"], e.message);
  }
  const other = (await submitProblem(new Error("something else"), true, status).response.json()) as { thisRequest: string };
  assert.equal(other.thisRequest, "may_have_sent", "anything else stays indeterminate");
});

test("503 store_busy with Retry-After while another process holds the write lock; nothing voided", async () => {
  const b = await hand("BUSY-ONE");
  const other = new Database(DB);
  other.exec("BEGIN IMMEDIATE");
  try {
    const v = await voidIt(b.body.id!);
    assert.deepEqual([v.status, v.body.code, v.retry], [503, "store_busy", "1"]);
  } finally {
    other.exec("ROLLBACK");
    other.close();
  }
  assert.equal((await get(b.body.id!)).body.voided, null);
});
