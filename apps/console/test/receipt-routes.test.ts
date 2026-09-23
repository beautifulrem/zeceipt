// Receipt routes (slice D3) on the committed fixture transaction (real `zeceipt` binary, offline raw tx)
// with the fake Zkool as the chain: waiting is 202 (pending, not invalid), a confirmed batch gets one
// verified bearer receipt per item (no challenge), a second issue returns the stored receipts without
// running the CLI, and every refusal or failure records nothing and quotes no CLI output.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { batchDigest, batchNonce, bootServerContext, defaultMigrationsDir, getBatch, SERVER_CONTEXT_KEY, toExecutionBatch, type BootState, type ZeceiptCliOptions } from "../lib/index.ts";
import { issueReceiptsResponse, issuerCli, listReceiptsResponse, type ReceiptJson } from "../lib/http/receipts.ts";
import { HttpProblem, type ProblemJson } from "../lib/http/problem.ts";
import * as collection from "../app/api/batches/route.ts";
import * as receiptsRoute from "../app/api/batches/[id]/receipts/route.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const RAW = join(ROOT, `fixtures/regtest-${TXID}.hex`);
const UFVK = join(ROOT, "fixtures/regtest-issuer-ufvk.txt");
const PAYEES = [
  { payableId: "p-2", label: "R2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "INV-R-002" },
  { payableId: "p-3", label: "R3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "102000000", memo: "INV-R-003" },
  { payableId: "p-4", label: "R4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: "103000000", memo: "INV-R-004" },
];
const HOST = "127.0.0.1:3000";
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const dir = mkdtempSync(join(tmpdir(), "zeceipt-receipts-"));
let fake: FakeZkool;
let cli: ZeceiptCliOptions;

type Body = Partial<ProblemJson> & { batchId?: string; txid?: string; state?: string; confirmations?: number; required?: number; inserted?: number[]; existing?: number[]; receipts?: ReceiptJson[] };
const read = async (r: Response) => ({ status: r.status, cache: r.headers.get("cache-control"), body: (await r.json()) as Body });
/** The handler throws its problems (the route's `guarded` maps them); unwrap them the same way here. */
const issue = (id: string, c: ZeceiptCliOptions) => issueReceiptsResponse(id, c).catch((e: unknown) => (e instanceof HttpProblem ? e.response : Promise.reject(e)));
const count = () => (slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT count(*) AS n FROM receipts").get() as { n: number }).n;

/** A fresh context (own org and database), a batch of the fixture's payees, optionally broadcast as the fixture tx. */
async function scenario(org: string, opts: { broadcast?: "broadcast" | "unknown_outcome" | null } = {}) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  const env: Record<string, string> = {
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: fake.url,
    ZECEIPT_ZKOOL_ACCOUNT: "9",
    ZECEIPT_DB_PATH: join(dir, `${org}.db`),
    ZECEIPT_ORG_ID: org,
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1", // nothing listens: the route export must never reach it in these tests
    ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: UFVK,
    ZECEIPT_ISSUER_KEY_FILE: join(dir, "issuer.key"),
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
  };
  const ctx = bootServerContext(env, { migrationsFolder: defaultMigrationsDir() });
  const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}` };
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: org, items: PAYEES }) }), undefined);
  assert.equal(r.status, 201);
  const id = ((await r.json()) as { id: string }).id;
  const rec = (await getBatch(ctx.db, org, id))!;
  if (opts.broadcast !== null && opts.broadcast !== undefined) {
    const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: new Date().toISOString(), attempts: 1 };
    await ctx.store.createIntent({ ...base, state: "submitting" });
    const next = opts.broadcast === "broadcast" ? { ...base, state: "broadcast" as const, txid: TXID, broadcastAt: new Date().toISOString() } : { ...base, state: "unknown_outcome" as const, error: "lost answer", expiresBy: fake.height + 50 };
    assert.equal(await ctx.store.update(next, { attempts: 1, states: ["submitting"] }), true);
  }
  return id;
}
/** Put the fixture tx on the fake chain with `confirmations` confirmations. */
function onChain(confirmations: number) {
  fake.mined = fake.mined.filter((t) => t.txid !== TXID);
  fake.mined.push({ txid: TXID, height: fake.height - confirmations + 1, expiry: fake.height + 40, recipients: [] });
}

before(async () => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN}`);
  execFileSync(BIN, ["keygen", "--out", join(dir, "issuer.key")]);
  fake = await new FakeZkool().start();
  fake.height = fake.scanned = 700;
  cli = { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile: join(dir, "issuer.key"), keyId: "2026-09" };
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
});

test("below the threshold: 202 waiting (pending, not invalid); nothing recorded", async () => {
  const id = await scenario("org-wait", { broadcast: "broadcast" });
  onChain(1);
  const r = await read(await issue(id, cli));
  assert.deepEqual([r.status, r.body.state, r.body.confirmations, r.body.required], [202, "waiting", 1, 3]);
  assert.equal(count(), 0);
});

test("the route and the page issue with the deployment's CLI options: its receipt host, its lightwalletd, no challenge (slice F3)", async () => {
  await scenario("org-cli");
  const config = slot[SERVER_CONTEXT_KEY]!.config;
  assert.equal(config.receiptHost, "https://zeceipt.xyz", "unset: the CLI's default");
  assert.deepEqual(issuerCli(config), { bin: BIN, endpoint: "http://127.0.0.1:1/", ufvkFile: UFVK, keyFile: join(dir, "issuer.key"), keyId: "2026-09", host: "https://zeceipt.xyz" });
  assert.equal(issuerCli({ ...config, receiptHost: "http://127.0.0.1:8787" }).host, "http://127.0.0.1:8787");
});

test("confirmed: 201 with one verified bearer receipt per item (no challenge); a second issue returns them without the CLI; GET lists them", async () => {
  const id = await scenario("org-issue", { broadcast: "broadcast" });
  onChain(3);
  const r = await read(await issue(id, cli));
  assert.equal(r.status, 201);
  assert.equal(r.cache, "no-store");
  assert.deepEqual([r.body.txid, r.body.inserted, r.body.existing], [TXID, [0, 1, 2], []]);
  assert.deepEqual(r.body.receipts!.map((x) => [x.idx, x.payableId, x.memo, x.valueZat, x.txid]), PAYEES.map((p, i) => [i, p.payableId, p.memo, p.zat, TXID]));
  for (const x of r.body.receipts!) {
    if (!("url" in x)) assert.fail(`receipt ${x.idx} did not open`);
    assert.ok(x.url && x.url.length > 20, "a shareable receipt link");
    assert.equal("challenge" in x.receipt!, false, "console receipts carry no challenge");
    const v = JSON.parse(execFileSync(BIN, ["verify", "--regtest", "--raw-tx-file", RAW, "-", "--require-signature"], { input: JSON.stringify(x.receipt) }).toString()) as { valid: boolean; challenge_checked: boolean };
    assert.deepEqual([v.valid, v.challenge_checked], [true, false]);
  }
  assert.equal(count(), 3);

  // Idempotent: the stored receipts come back and the CLI is not run (a missing binary would fail).
  const again = await read(await issue(id, { ...cli, bin: join(dir, "no-such-binary") }));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.receipts, r.body.receipts);
  assert.equal(count(), 3);

  const listed = await read(await listReceiptsResponse(id));
  assert.deepEqual([listed.status, listed.body.receipts], [200, r.body.receipts]);
});

test("concurrent issues: exactly one receipt per item; only the request that recorded them answers 201", async () => {
  const id = await scenario("org-race", { broadcast: "broadcast" });
  onChain(3);
  const answers = await Promise.all([1, 2, 3].map(async () => read(await issue(id, cli))));
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 200, 201]);
  const winner = answers.find((a) => a.status === 201)!;
  assert.deepEqual(winner.body.inserted, [0, 1, 2]);
  for (const a of answers.filter((x) => x.status === 200)) assert.deepEqual([a.body.inserted, a.body.existing, a.body.receipts], [[], [0, 1, 2], winner.body.receipts]);
  assert.equal(count(), 3);
});

test("not ready: a draft or an uncertain batch is refused with its state and next action; nothing recorded", async () => {
  const draft = await scenario("org-draft", { broadcast: null });
  const d = await read(await issue(draft, cli));
  assert.deepEqual([d.status, d.body.code, d.body.state, d.body.next], [409, "not_ready_for_receipts", "draft", "submit"]);
  const uncertain = await scenario("org-uncertain", { broadcast: "unknown_outcome" });
  const u = await read(await issue(uncertain, cli));
  assert.deepEqual([u.status, u.body.code, u.body.state], [409, "not_ready_for_receipts", "needs_attention"]);
  assert.equal(count(), 0);
});

test("a CLI failure: 502 issuance_failed, nothing recorded, no path or stderr in the body", async () => {
  const id = await scenario("org-fail", { broadcast: "broadcast" });
  onChain(3);
  const wrong = join(dir, "missing-ufvk.txt");
  const r = await read(await receiptsRoute.POST(new Request(`http://${HOST}/api/batches/${id}/receipts`, { method: "POST", headers: { host: HOST } }), { params: Promise.resolve({ id }) }).then(async (res) => res));
  // Through the route export the config's lightwalletd (nothing listening) is used: the CLI fails.
  assert.deepEqual([r.status, r.body.code], [502, "issuance_failed"]);
  const viaCli = await issueReceiptsResponse(id, { ...cli, ufvkFile: wrong }).catch((e: unknown) => e);
  assert.ok(viaCli instanceof Error, "the handler throws; the route maps it");
  const body = JSON.stringify(r.body);
  for (const leak of [dir, "127.0.0.1:1", "error", "No such file"]) assert.ok(!body.includes(leak), `leaked ${leak}`);
  assert.equal(count(), 0);
});

test("the route export: guarded, wired to the config's issuer; a draft is refused before any CLI run; external custody has no issuance", async () => {
  const id = await scenario("org-route", { broadcast: null });
  const r = await read(await receiptsRoute.POST(new Request(`http://${HOST}/api/batches/${id}/receipts`, { method: "POST", headers: { host: HOST } }), { params: Promise.resolve({ id }) }));
  assert.deepEqual([r.status, r.body.code, r.body.state], [409, "not_ready_for_receipts", "draft"]);
  const listed = await read(await receiptsRoute.GET(new Request(`http://${HOST}/api/batches/${id}/receipts`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) }));
  assert.deepEqual([listed.status, listed.body.receipts], [200, []]);
  const missing = await read(await receiptsRoute.GET(new Request(`http://${HOST}/api/batches/nope/receipts`, { headers: { host: HOST } }), { params: Promise.resolve({ id: "nope" }) }));
  assert.deepEqual([missing.status, missing.body.code], [404, "batch_not_found"]);

  slot[SERVER_CONTEXT_KEY]!.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  bootServerContext(
    {
      ZECEIPT_CUSTODY_MODE: "external",
      ZECEIPT_DB_PATH: join(dir, "org-route.db"),
      ZECEIPT_ORG_ID: "org-route",
      ZECEIPT_NETWORK: "regtest",
      ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
      ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
      ZECEIPT_BIN: BIN,
      ZECEIPT_UFVK_FILE: UFVK,
      ZECEIPT_ISSUER_KEY_FILE: join(dir, "issuer.key"),
      ZECEIPT_ISSUER_KEY_ID: "2026-09",
    },
    { migrationsFolder: defaultMigrationsDir() },
  );
  const ext = await read(await receiptsRoute.POST(new Request(`http://${HOST}/api/batches/${id}/receipts`, { method: "POST", headers: { host: HOST } }), { params: Promise.resolve({ id }) }));
  assert.deepEqual([ext.status, ext.body.code], [409, "custody_external"]);
});
