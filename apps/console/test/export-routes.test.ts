// The OpenZcash export route (slice X2b; REQ-INT-2; `05` §3.1) on real receipts: the committed regtest transaction
// (Zkool's 3-recipient batch), issued by the real `zeceipt` binary with the fake Zkool as the chain, for a batch made
// on the form and for a batch made from payables at a locked rate. Checks the exact bytes, the headers, the audit row
// (format and count only), and each refusal: another site, an unknown batch, no receipts, an unreadable receipt.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  batchDigest, batchNonce, bootServerContext, recordQuote, createBatchFromPayables, createPayable, createRecipient, defaultMigrationsDir, getBatch, OPENZCASH_HEADER,
  SERVER_CONTEXT_KEY, toCsv, toExecutionBatch, type BootState, type ZeceiptCliOptions,
} from "../lib/index.ts";
import { issueReceiptsResponse, listReceiptsResponse, type ReceiptJson } from "../lib/http/receipts.ts";
import { HttpProblem } from "../lib/http/problem.ts";
import * as collection from "../app/api/batches/route.ts";
import * as exportRoute from "../app/api/batches/[id]/exports/openzcash/route.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { ZKOOL_PUBLIC_PEM, zkoolPublicKeyFile, zkoolTokenFile } from "./helpers/zkool-token.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const RAW = join(ROOT, `fixtures/regtest-${TXID}.hex`);
const UFVK = join(ROOT, "fixtures/regtest-issuer-ufvk.txt");
// The fixture transaction's three outputs: address, zat and memo, as in receipt-routes.test.ts.
const OUTPUTS = [
  { address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "INV-R-002" },
  { address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "102000000", memo: "INV-R-003" },
  { address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: "103000000", memo: "INV-R-004" },
];
const BROADCAST_AT = "2026-09-25T23:10:00.000Z";
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-export-"));
let fake: FakeZkool;
let cli: ZeceiptCliOptions;

const db = () => slot[SERVER_CONTEXT_KEY]!.db;
const exportsOf = (batchId: string) => db().$client.prepare("SELECT action, detail FROM audit_log WHERE batch_id = ? AND action = 'exported' ORDER BY id").all(batchId) as { action: string; detail: string }[];
const get = (id: string, headers: Record<string, string> = {}) =>
  exportRoute.GET(new Request(`http://${HOST}/api/batches/${id}/exports/openzcash`, { headers: { host: HOST, ...headers } }), { params: Promise.resolve({ id }) });
const issue = (id: string) => issueReceiptsResponse(id, cli).catch((e: unknown) => (e instanceof HttpProblem ? e.response : Promise.reject(e)));
/** The body's exact bytes as text (`Response.text()` would drop the BOM). */
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString("utf8");
const urls = async (id: string) => ((await (await listReceiptsResponse(id)).json()) as { receipts: ReceiptJson[] }).receipts.map((r) => ("url" in r ? r.url! : ""));

function boot(org: string) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  return bootServerContext({
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: fake.url,
    ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(),
    ZECEIPT_DB_PATH: join(dir, `${org}.db`),
    ZECEIPT_ORG_ID: org,
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
    ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: UFVK,
    ZECEIPT_ISSUER_KEY_FILE: join(dir, "issuer.key"),
    ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  }, { migrationsFolder: defaultMigrationsDir() });
}

/** Mark the batch broadcast as the fixture transaction (at BROADCAST_AT), mined with 3 confirmations. */
async function broadcast(ctx: ReturnType<typeof bootServerContext>, id: string) {
  const rec = (await getBatch(ctx.db, ctx.config.orgId, id))!;
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: BROADCAST_AT, attempts: 1 };
  await ctx.store.createIntent({ ...base, state: "submitting" });
  assert.equal(await ctx.store.update({ ...base, state: "broadcast", txid: TXID, broadcastAt: BROADCAST_AT }, { attempts: 1, states: ["submitting"] }), true);
  fake.mined = fake.mined.filter((t) => t.txid !== TXID);
  fake.mined.push({ txid: TXID, height: fake.height - 2, expiry: fake.height + 40, recipients: [] });
}

/** A batch made on the form, paying the fixture's outputs; optionally broadcast and with its receipts issued. */
async function formBatch(org: string, opts: { issued: boolean }) {
  const ctx = boot(org);
  const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}` };
  const items = OUTPUTS.map((o, i) => ({ payableId: `p-${i + 2}`, label: `R${i + 2}`, ...o }));
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: org, items }) }), undefined);
  assert.equal(r.status, 201);
  const id = ((await r.json()) as { id: string }).id;
  // A real form batch is always locked before it pays (G2b1): lock it, so Rate's · is tested against a lock that exists.
  const quote = { source: "kraken" as const, pair: "XZECZUSD" as const, bid: "1553.29", ask: "1553.80", last: "1553.21", rate: "1553.29", fetchedAt: "2026-09-25T23:00:00.000Z", host: "api.kraken.com" };
  await recordQuote(ctx.db, { orgId: org, batchId: id, purpose: "lock", quote });
  await broadcast(ctx, id);
  if (opts.issued) assert.equal((await issue(id)).status, 201);
  return id;
}

before(async () => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN}`);
  execFileSync(BIN, ["keygen", "--out", join(dir, "issuer.key")]);
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  fake.height = fake.scanned = 700;
  cli = { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile: join(dir, "issuer.key"), host: "https://receipts.example", keyId: "2026-09" };
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
});

test("a batch made on the form (locked, as every paying batch is): 200, the exact CSV (no dollars, no category, and no rate: its lines were set in ZEC), attachment and no-store, one audit row", async () => {
  const id = await formBatch("org-form", { issued: true });
  const links = await urls(id);
  const r = await get(id);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(r.headers.get("content-disposition"), `attachment; filename="zeceipt-openzcash-${id}.csv"`);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual([r.headers.get("x-zeceipt-rows"), r.headers.get("x-zeceipt-lines")], ["3", "3"]);
  const want = toCsv(OPENZCASH_HEADER, [
    ["R2", "INV-R-002", "·", "·", "1.01", "2026-09-25", "Completed", TXID, links[0], "·"],
    ["R3", "INV-R-003", "·", "·", "1.02", "2026-09-25", "Completed", TXID, links[1], "·"],
    ["R4", "INV-R-004", "·", "·", "1.03", "2026-09-25", "Completed", TXID, links[2], "·"],
  ]);
  assert.equal(await bytes(r), want);
  assert.ok(links.every((u) => u.startsWith("https://receipts.example/r#")), "the links are the configured host's");
  assert.deepEqual(exportsOf(id), [{ action: "exported", detail: JSON.stringify({ format: "openzcash", rows: 3 }) }], "format and count only: no link, memo or amount");
});

test("a batch made from payables: dollars, the payable kind and the locked rate", async () => {
  const org = "org-payables";
  const ctx = boot(org);
  const kinds = ["invoice", "bounty", "salary"] as const;
  const ids: string[] = [];
  for (const [i, o] of OUTPUTS.entries()) {
    const recipient = await createRecipient(ctx.db, { orgId: org, network: "regtest", displayName: `Contributor ${i + 2}`, address: o.address });
    // $101.00 at 100 USD/ZEC is 1.01 ZEC = 101000000 zat, the fixture's first output, and so on.
    ids.push((await createPayable(ctx.db, { orgId: org, recipientId: recipient.id, kind: kinds[i], usdCents: 10100 + i * 100, reference: o.memo })).id);
  }
  const quote = { source: "kraken" as const, pair: "XZECZUSD" as const, bid: "100", ask: "100", last: "100", rate: "100", fetchedAt: "2026-09-25T23:00:00.000Z", host: "api.kraken.com" };
  const { batch } = await createBatchFromPayables(ctx.db, { orgId: org, network: "regtest", title: "September", payableIds: ids, quote });
  assert.deepEqual(batch.items.map((it) => it.zat.toString()), OUTPUTS.map((o) => o.zat), "the lines pay the fixture's outputs");
  await broadcast(ctx, batch.id);
  assert.equal((await issue(batch.id)).status, 201);
  const links = await urls(batch.id);
  const r = await get(batch.id, { "sec-fetch-site": "same-origin" });
  assert.equal(r.status, 200);
  assert.equal(await bytes(r), toCsv(OPENZCASH_HEADER, [
    ["Contributor 2", "INV-R-002", "Invoice", "$101", "1.01", "2026-09-25", "Completed", TXID, links[0], "100"],
    ["Contributor 3", "INV-R-003", "Bounty", "$102", "1.02", "2026-09-25", "Completed", TXID, links[1], "100"],
    ["Contributor 4", "INV-R-004", "Salary", "$103", "1.03", "2026-09-25", "Completed", TXID, links[2], "100"],
  ]));
});

test("another site cannot make the browser download it: cross-site and same-site are 403 and record nothing; typed URLs pass", async () => {
  const id = await formBatch("org-site", { issued: true });
  for (const site of ["cross-site", "same-site"]) {
    const r = await get(id, { "sec-fetch-site": site });
    assert.equal(r.status, 403, site);
    assert.equal(((await r.json()) as { code: string }).code, "cross_site_request");
  }
  const foreign = await exportRoute.GET(new Request(`http://evil.example/api/batches/${id}/exports/openzcash`, { headers: { host: "evil.example" } }), { params: Promise.resolve({ id }) });
  assert.equal(foreign.status, 403, "a foreign Host (DNS rebinding) is refused by the guard");
  assert.equal(exportsOf(id).length, 0);
  assert.equal((await get(id, { "sec-fetch-site": "none" })).status, 200, "typed or bookmarked");
  assert.equal(exportsOf(id).length, 1);
});

test("refusals: an unknown batch is 404; a batch without receipts is 409 no_receipts; nothing is recorded", async () => {
  const id = await formBatch("org-none", { issued: false });
  const none = await get(id);
  assert.equal(none.status, 409);
  assert.equal(((await none.json()) as { code: string }).code, "no_receipts");
  for (const bad of ["0192f0e2-0000-7000-8000-000000000000", "not-a-uuid"]) {
    const r = await get(bad);
    assert.equal(r.status, 404, bad);
  }
  assert.equal(exportsOf(id).length, 0);
});

test("a receipt that does not open is 409 receipt_unreadable naming its line, never a file with a row missing", async () => {
  const id = await formBatch("org-damaged", { issued: true });
  // Re-wrapping may change `sealed` (the only column the trigger lets change, and only to a well-formed envelope):
  // flip one character of line 1's ciphertext, so the envelope keeps its shape but no longer opens.
  const row = db().$client.prepare("SELECT sealed FROM receipts WHERE batch_id = ? AND idx = 1").get(id) as { sealed: string };
  const env = JSON.parse(row.sealed) as { ct: string };
  env.ct = (env.ct[0] === "A" ? "B" : "A") + env.ct.slice(1);
  const damaged = JSON.stringify(env);
  db().$client.prepare("UPDATE receipts SET sealed = ? WHERE batch_id = ? AND idx = 1").run(damaged, id);
  const r = await get(id);
  assert.equal(r.status, 409);
  const body = (await r.json()) as { code: string; items: number[]; detail: string };
  assert.deepEqual([body.code, body.items], ["receipt_unreadable", [1]]);
  assert.ok(!body.detail.includes("receipts.example"), "no receipt data in the problem");
  assert.equal(exportsOf(id).length, 0);
});

test("HEAD downloads nothing and records nothing: 405 with Allow: GET (Next.js would otherwise run GET for it)", async () => {
  const id = await formBatch("org-head", { issued: true });
  const r = await exportRoute.HEAD(new Request(`http://${HOST}/api/batches/${id}/exports/openzcash`, { method: "HEAD", headers: { host: HOST } }), { params: Promise.resolve({ id }) });
  assert.deepEqual([r.status, r.headers.get("allow")], [405, "GET"]);
  assert.equal(exportsOf(id).length, 0);
});

test("Date is written only when the submission's txid is the receipt's", async () => {
  const id = await formBatch("org-txid", { issued: true });
  // Simulate a submission whose recorded txid is not the one the receipts name (review X2b round 1): Date must be ·.
  const other = "ff".repeat(32);
  db().$client.prepare("UPDATE submissions SET txid = ? WHERE batch_id = ?").run(other, id);
  const text = Buffer.from(await (await get(id)).arrayBuffer()).toString("utf8");
  const dates = text.split("\r\n").slice(1).map((line) => line.split('","')[5]);
  assert.deepEqual(dates, ["·", "·", "·"]);
});
