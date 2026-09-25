// GET /api/batches/{id}/history (slice I4; design I4.4.2) through the real route exports: a batch locked, approved,
// refused by the wallet, then paid on the retry, reads back as one event per step. That includes the refused attempt,
// which the submission row alone no longer shows. Then 404, the guard's 403 (a foreign Host) and 503 before boot.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type AuditEvent, type BootState } from "../lib/index.ts";
import * as collection from "../app/api/batches/route.ts";
import * as historyRoute from "../app/api/batches/[id]/history/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";
import * as submitRoute from "../app/api/batches/[id]/submit/route.ts";
import { approve } from "./helpers/approve.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { eventText } from "../lib/view/history.ts";
import { ZKOOL_PUBLIC_PEM, zkoolTokenFile } from "./helpers/zkool-token.ts";

const HOST = "127.0.0.1:3000";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-history-"));
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ticker = JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1601.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } });
const source = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(ticker));
let fake: FakeZkool;

function boot() {
  return bootServerContext({
    ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_DB_PATH: join(dir, "console.db"), ZECEIPT_ORG_ID: "demo-org", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
  }, { migrationsFolder: defaultMigrationsDir() });
}
before(async () => {
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  boot();
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
  await new Promise((r) => source.close(r));
});

const history = async (id: string, host = HOST) => {
  const r = await historyRoute.GET(new Request(`http://${host}/api/batches/${id}/history`, { headers: { host } }), params(id));
  return { status: r.status, headers: r.headers, body: (await r.json()) as { batchId?: string; events?: AuditEvent[]; code?: string } };
};
const submit = (id: string) => submitRoute.POST(new Request(`http://${HOST}/api/batches/${id}/submit`, { method: "POST", headers, body: JSON.stringify({ confirmTotalZat: "1000" }) }), params(id));

test("lock, approve, a wallet refusal, the retry pays: the history names every step, the refused attempt included", async () => {
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: "history", items: [{ payableId: "h1", address: UA, zat: "1000", memo: "HIST-1" }] }) }), undefined);
  const id = ((await r.json()) as { id: string }).id;
  assert.equal((await lockRoute.POST(new Request(`http://${HOST}/api/batches/${id}/rate-lock`, { method: "POST", headers }), params(id))).status, 201);
  await approve(id);
  fake.nextPay = "refused";
  assert.equal((await submit(id)).status, 409);
  const paid = await submit(id);
  assert.equal(paid.status, 202);
  const txid = ((await paid.json()) as { txid: string }).txid;

  const h = await history(id);
  assert.equal(h.status, 200);
  assert.equal(h.headers.get("cache-control"), "no-store");
  assert.equal(h.body.batchId, id);
  const events = h.body.events!;
  assert.deepEqual(events.map((e) => e.action), [
    "created",
    "locked",
    "approved",
    "quoted", // the first attempt's execution quote (the rate guard)
    "attempt_submitting",
    "attempt_failed_retryable",
    "quoted", // the retry's execution quote
    "attempt_submitting",
    "attempt_broadcast",
    "expiry_recorded",
  ]);
  const words = events.map(eventText);
  assert.ok(words.includes("Payment attempt 1 sent nothing: Not enough funds, 1.5 more ZEC required"), words.join(" | "));
  assert.ok(words.includes(`Payment attempt 2 broadcast as ${txid}`));
  assert.ok(words.includes("Approved at lock 1") && words.includes("Rate locked at 1 ZEC = $1,600.00 (lock 1)"));
  assert.ok(events.every((e, i) => i === 0 || e.id > events[i - 1].id));
});

test("404 for an unknown or malformed id; the guard's 403 for a foreign Host", async () => {
  for (const id of ["01900000-0000-7000-8000-000000000000", "not-a-uuid"]) {
    const r = await history(id);
    assert.deepEqual([r.status, r.body.code], [404, "batch_not_found"]);
  }
  assert.equal((await history("01900000-0000-7000-8000-000000000000", "evil.example")).status, 403);
});

test("503 not_ready before boot", async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  try {
    const r = await history("01900000-0000-7000-8000-000000000000");
    assert.deepEqual([r.status, r.body.code], [503, "not_ready"]);
  } finally {
    boot();
  }
});
