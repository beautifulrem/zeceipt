// GET /api/recipients/{id}/history and GET /api/payables/{id}/history (slice I4b; design I4b.4.2) through the real
// route exports: records created through their routes, then changed and deleted by SQL (the console has no edit
// route), read back as their trails; a deleted record's trail stays readable; 404 for an unknown id and for the other
// kind's id; the guard's 403 (a foreign Host); 503 before boot.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServerContext, defaultMigrationsDir, SERVER_CONTEXT_KEY, type BootState, type RecordEvent } from "../lib/index.ts";
import * as recipients from "../app/api/recipients/route.ts";
import * as payables from "../app/api/payables/route.ts";
import * as recipientHistory from "../app/api/recipients/[id]/history/route.ts";
import * as payableHistory from "../app/api/payables/[id]/history/route.ts";
import { shortAddress } from "../lib/view/format.ts";

const HOST = "127.0.0.1:3000";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const UA2 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-record-history-"));
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function boot() {
  return bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "console.db"), ZECEIPT_ORG_ID: "demo-org", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt", ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt", ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  }, { migrationsFolder: defaultMigrationsDir() });
}
before(() => void boot());
after(() => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

type Body = { kind?: string; id?: string; events?: RecordEvent[]; code?: string };
const read = async (r: Response) => ({ status: r.status, headers: r.headers, body: (await r.json()) as Body });
const history = async (kind: "recipient" | "payable", id: string, host = HOST) => {
  const route = kind === "recipient" ? recipientHistory : payableHistory;
  return read(await route.GET(new Request(`http://${host}/api/${kind}s/${id}/history`, { headers: { host } }), params(id)));
};
const sql = (text: string, ...args: unknown[]) => slot[SERVER_CONTEXT_KEY]!.db.$client.prepare(text).run(...args);

test("a recipient and a payable, created through the routes, changed and deleted: each trail reads back in order", async () => {
  const r = (await read(await recipients.POST(new Request(`http://${HOST}/api/recipients`, { method: "POST", headers, body: JSON.stringify({ displayName: "Alice", address: UA }) }), undefined))).body as { id: string };
  const p = (await read(await payables.POST(new Request(`http://${HOST}/api/payables`, { method: "POST", headers, body: JSON.stringify({ recipientId: r.id, kind: "invoice", usdCents: 160000, reference: "INV-H-1" }) }), undefined))).body as { id: string };
  sql("UPDATE recipients SET address = ?, updated_at = '2026-09-25T12:00:00.000Z' WHERE id = ?", UA2, r.id);
  sql("DELETE FROM payables WHERE id = ?", p.id);

  const rh = await history("recipient", r.id);
  assert.equal(rh.status, 200);
  assert.equal(rh.headers.get("cache-control"), "no-store");
  assert.deepEqual([rh.body.kind, rh.body.id], ["recipient", r.id]);
  assert.deepEqual(rh.body.events!.map((e) => e.action), ["created", "changed"]);
  assert.deepEqual(rh.body.events![1].detail, { fields: { address: { previous: shortAddress(UA), current: shortAddress(UA2) } } }, "the payee's address change, abridged");

  const ph = await history("payable", p.id);
  assert.equal(ph.status, 200);
  assert.deepEqual(ph.body.events!.map((e) => e.action), ["created", "deleted"], "a deleted record's trail stays readable");
});

test("404 for an unknown id, a malformed id and the other kind's id; the guard's 403 for a foreign Host", async () => {
  const r = (await read(await recipients.POST(new Request(`http://${HOST}/api/recipients`, { method: "POST", headers, body: JSON.stringify({ displayName: "Bob", address: UA }) }), undefined))).body as { id: string };
  for (const [kind, id, code] of [["recipient", "01900000-0000-7000-8000-000000000000", "recipient_not_found"], ["payable", "not-a-uuid", "payable_not_found"], ["payable", r.id, "payable_not_found"]] as const) {
    const h = await history(kind, id);
    assert.deepEqual([h.status, h.body.code], [404, code], `${kind} ${id}`);
  }
  assert.equal((await history("recipient", r.id, "evil.example")).status, 403);
});

test("503 not_ready before boot", async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  try {
    const h = await history("payable", "01900000-0000-7000-8000-000000000000");
    assert.deepEqual([h.status, h.body.code], [503, "not_ready"]);
  } finally {
    boot();
  }
});
