// REQ-CON-10 (slice I1): "confirmations configurable", through HTTP. One batch, paid through the routes to a fake Zkool
// and mined with 2 confirmations, reads `confirming` when the console requires 3 (ZECEIPT_CONFIRMATIONS) and
// `confirmed` when it requires 2: the same chain facts, a different configured N, a different state.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState } from "../lib/index.ts";
import * as collection from "../app/api/batches/route.ts";
import * as lockRoute from "../app/api/batches/[id]/rate-lock/route.ts";
import * as submitRoute from "../app/api/batches/[id]/submit/route.ts";
import * as statusRoute from "../app/api/batches/[id]/status/route.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { approve } from "./helpers/approve.ts";
import { ZKOOL_PUBLIC_PEM, zkoolTokenFile } from "./helpers/zkool-token.ts";

const HOST = "127.0.0.1:3000";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const DB = join(mkdtempSync(join(tmpdir(), "zeceipt-i1-")), "console.db");
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const source = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1600.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } })));
let fake: FakeZkool;

function boot(confirmations: string) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_DB_PATH: DB, ZECEIPT_ORG_ID: "org-i1", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: confirmations, ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
  }, { migrationsFolder: defaultMigrationsDir() });
}

before(async () => {
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  boot("3");
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
  await new Promise((r) => source.close(r));
});

const status = async (id: string) => (await (await statusRoute.GET(new Request(`http://${HOST}/api/batches/${id}/status`, { headers: { host: HOST } }), params(id))).json()) as { state: string; next: string; detail: { confirmations?: number; required?: number } };

test("REQ-CON-10: the same batch at 2 confirmations is confirming under N=3 and confirmed under N=2", async () => {
  const created = (await (await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: "I1", items: [{ payableId: "i1-1", address: UA, zat: "1000", memo: "I1-1" }] }) }), undefined)).json()) as { id: string };
  assert.equal((await lockRoute.POST(new Request(`http://${HOST}/x`, { method: "POST", headers }), params(created.id))).status, 201);
  assert.deepEqual([(await status(created.id)).state, (await status(created.id)).next], ["draft", "approve"]);
  await approve(created.id); // slice I3: REQ-CON-10's "approved"
  assert.deepEqual([(await status(created.id)).state, (await status(created.id)).next], ["approved", "submit"]);
  const paid = await submitRoute.POST(new Request(`http://${HOST}/x`, { method: "POST", headers, body: JSON.stringify({ confirmTotalZat: "1000" }) }), params(created.id));
  assert.equal(paid.status, 202);
  assert.equal((await status(created.id)).state, "pending", "broadcast, not in a block");
  fake.mine(1); // in a block, and one on top: 2 confirmations
  const underThree = await status(created.id);
  assert.deepEqual([underThree.state, underThree.next, underThree.detail.confirmations, underThree.detail.required], ["confirming", "wait", 2, 3]);
  boot("2"); // the same database, the console now configured for 2
  const underTwo = await status(created.id);
  assert.deepEqual([underTwo.state, underTwo.next], ["confirmed", "issue_receipts"]);
});
