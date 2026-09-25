// The linkability fields over HTTP (slice H6; REQ-CON-6): `linkability` on a batch and `disclosedBy` on recipients,
// empty until a real receipt (the fixture transaction, the real CLI) discloses an address, then naming its batch.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  autoIssue, batchDigest, batchNonce, bootServerContext, defaultMigrationsDir, getBatch, recordReceipts, SERVER_CONTEXT_KEY, serverContext, SqliteIdempotencyStore, toExecutionBatch,
  type AutoIssueResult, type BootState,
} from "../lib/index.ts";
import * as batches from "../app/api/batches/route.ts";
import * as batchItem from "../app/api/batches/[id]/route.ts";
import * as recipients from "../app/api/recipients/route.ts";
import * as recipientItem from "../app/api/recipients/[id]/route.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const HOST = "127.0.0.1:3000";
const headers = { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" };
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-h6-routes-"));
const PAYEES = [
  { payableId: "p-2", label: "R2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "INV-R-002" },
  { payableId: "p-3", label: "R3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "102000000", memo: "INV-R-003" },
  { payableId: "p-4", label: "R4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: "103000000", memo: "INV-R-004" },
];

before(() => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN}`);
  bootServerContext({
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "console.db"), ZECEIPT_ORG_ID: "org-h6r", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: BIN, ZECEIPT_UFVK_FILE: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  }, { migrationsFolder: defaultMigrationsDir() });
});
after(() => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

type Json = Record<string, unknown> & { id: string; linkability?: { idx: number; disclosedBy: { batchId: string }[] }[]; disclosedBy?: { batchId: string }[] };
const post = async (mod: typeof batches | typeof recipients, path: string, body: unknown) => (await (await mod.POST(new Request(`http://${HOST}${path}`, { method: "POST", headers, body: JSON.stringify(body) }), undefined)).json()) as Json;
const getBatchJson = async (id: string) => (await (await batchItem.GET(new Request(`http://${HOST}/api/batches/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) })).json()) as Json;
const getRecipientJson = async (id: string) => (await (await recipientItem.GET(new Request(`http://${HOST}/api/recipients/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) })).json()) as Json;
const listRecipientsJson = async () => ((await (await recipients.GET(new Request(`http://${HOST}/api/recipients`, { headers: { host: HOST } }), undefined)).json()) as { recipients: Json[] }).recipients;

test("empty before any receipt; after real receipts for batch A, batch B's line and the recipient name A (REQ-CON-6)", async () => {
  const bob = await post(recipients, "/api/recipients", { displayName: "Bob", address: PAYEES[1].address });
  assert.deepEqual(bob.disclosedBy, [], "nothing disclosed yet");
  const a = await post(batches, "/api/batches", { title: "September", items: PAYEES });
  assert.deepEqual(a.linkability, []);
  // Receipts for A: broadcast as the fixture transaction, issued by the real CLI, recorded with the server's keyring.
  const { db, keyring } = serverContext();
  const rec = (await getBatch(db, "org-h6r", a.id))!;
  const store = new SqliteIdempotencyStore(db, { orgId: "org-h6r" });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "t", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
  const keyFile = join(dir, "issuer.key");
  execFileSync(BIN, ["keygen", "--out", keyFile]);
  const out = await autoIssue({ batch: toExecutionBatch(rec), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, cli: { bin: BIN, rawTxFile: join(ROOT, `fixtures/regtest-${TXID}.hex`), ufvkFile: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), keyFile, host: "https://receipts.example", keyId: "2026-09", challenge: "h6r" } });
  await recordReceipts(db, keyring, { orgId: "org-h6r", batchId: rec.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });

  assert.deepEqual((await getBatchJson(a.id)).linkability, [], "A's own receipts do not warn A");
  const b = await post(batches, "/api/batches", { title: "October", items: [{ payableId: "o-1", address: PAYEES[1].address, zat: "5", memo: "OCT-1" }] });
  assert.deepEqual(b.linkability, [{ idx: 0, disclosedBy: [{ batchId: a.id }] }], "the create answer carries the report");
  assert.deepEqual((await getBatchJson(b.id)).linkability, b.linkability, "and GET");
  assert.deepEqual((await getRecipientJson(bob.id)).disclosedBy, [{ batchId: a.id }]);
  assert.deepEqual((await listRecipientsJson()).find((r) => r.id === bob.id)?.disclosedBy, [{ batchId: a.id }]);
});
