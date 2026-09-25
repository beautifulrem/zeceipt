// Automatic receipt issuance (slice I2; REQ-CON-11): one pass issues every batch that is ready, through the same
// idempotent handler as the button (the fixture transaction, the real CLI, the fake Zkool, as receipt-routes.test.ts);
// what is not ready, voided or failing is left alone or reported by code; the loop runs passes in sequence.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { batchDigest, batchNonce, bootServerContext, defaultMigrationsDir, getBatch, listAudit, SERVER_CONTEXT_KEY, serverContext, toExecutionBatch, voidBatch, type BootState, type ZeceiptCliOptions } from "../lib/index.ts";
import { backoffPasses, MAX_BACKOFF_PASSES, receiptPass, startReceiptWorker, type PassResult } from "../lib/server/receipt-worker.ts";
import * as collection from "../app/api/batches/route.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { ZKOOL_PUBLIC_PEM, zkoolPublicKeyFile, zkoolTokenFile } from "./helpers/zkool-token.ts";

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
const dir = mkdtempSync(join(tmpdir(), "zeceipt-i2-"));
let fake: FakeZkool;
let cli: ZeceiptCliOptions;


/** A fresh context (own org and database), a batch of the fixture's payees, optionally broadcast as the fixture tx. */
async function scenario(org: string, opts: { broadcast?: "broadcast" | "unknown_outcome" | null } = {}) {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  const env: Record<string, string> = {
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: fake.url,
    ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(),
    ZECEIPT_DB_PATH: join(dir, `${org}.db`),
    ZECEIPT_ORG_ID: org,
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "3",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1", // nothing listens: the route export must never reach it in these tests
    ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: UFVK,
    ZECEIPT_ISSUER_KEY_FILE: join(dir, "issuer.key"),
    ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
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
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  fake.height = fake.scanned = 700;
  cli = { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile: join(dir, "issuer.key"), host: "https://receipts.example", keyId: "2026-09" };
});
after(async () => {
  slot[SERVER_CONTEXT_KEY]?.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
  await fake.stop();
});

const receiptsOf = (id: string) => slot[SERVER_CONTEXT_KEY]!.db.$client.prepare("SELECT count(*) FROM receipts WHERE batch_id = ?").pluck().get(id) as number;

test("REQ-CON-11: a confirmed batch gets one receipt per item without anyone pressing a button; the next pass records nothing new", async () => {
  const id = await scenario("i2-ready", { broadcast: "broadcast" });
  onChain(3);
  const first = await receiptPass({ cli });
  assert.deepEqual(first, { issued: [id], existing: [], failed: [], considered: [id], complete: [], voided: [] });
  assert.equal(receiptsOf(id), 3);
  assert.deepEqual(await receiptPass({ cli }), { issued: [], existing: [], failed: [], considered: [id], complete: [id], voided: [] }, "complete: skipped before the chain is asked");
  assert.equal(receiptsOf(id), 3);
  // Slice I4: the trail records one event per receipt, and never a receipt's secret (sealed envelope), memo or recipient.
  const trail = await listAudit(serverContext().db, "i2-ready", id);
  assert.deepEqual(trail.filter((e) => e.action === "receipt_issued").map((e) => [e.detail.idx, e.detail.txid]), [[0, TXID], [1, TXID], [2, TXID]]);
  const rows = serverContext().db.$client.prepare("SELECT sealed, memo_text, recipient FROM receipts WHERE batch_id = ?").all(id) as { sealed: string; memo_text: string; recipient: string }[];
  const text = JSON.stringify(trail);
  for (const r of rows) for (const secret of [r.sealed, r.memo_text, r.recipient]) assert.ok(!text.includes(secret), "no receipt secret, memo or recipient in the trail");
});

test("not ready or not payable: below N, a draft and a voided draft are left alone", async () => {
  const below = await scenario("i2-below", { broadcast: "broadcast" });
  onChain(2); // 2 of 3
  assert.deepEqual(await receiptPass({ cli }), { issued: [], existing: [], failed: [], considered: [below], complete: [], voided: [] });
  assert.equal(receiptsOf(below), 0);
  const draft = await scenario("i2-draft");
  assert.deepEqual(await receiptPass({ cli }), { issued: [], existing: [], failed: [], considered: [draft], complete: [], voided: [] });
  await voidBatch(slot[SERVER_CONTEXT_KEY]!.db, "i2-draft", draft);
  assert.deepEqual(await receiptPass({ cli }), { issued: [], existing: [], failed: [], considered: [draft], complete: [], voided: [draft] });
});

test("one batch failing is reported by code and does not stop the pass: the other is issued", async () => {
  const good = await scenario("i2-mixed", { broadcast: "broadcast" });
  // A second batch of the same org, broadcast "as" the fixture transaction but with its own memos (memos are unique per
  // org): the transaction does not pay them, so its issuance fails, and nothing is recorded for it.
  const ctx = serverContext();
  const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}` };
  const r = await collection.POST(new Request(`http://${HOST}/api/batches`, { method: "POST", headers, body: JSON.stringify({ title: "other", items: PAYEES.map((p) => ({ ...p, payableId: `${p.payableId}-x`, memo: `${p.memo}-X` })) }) }), undefined);
  const bad = ((await r.json()) as { id: string }).id;
  const rec = (await getBatch(ctx.db, "i2-mixed", bad))!;
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: new Date().toISOString(), attempts: 1 };
  await ctx.store.createIntent({ ...base, state: "submitting" });
  await ctx.store.update({ ...base, state: "broadcast", txid: TXID, broadcastAt: new Date().toISOString() }, { attempts: 1, states: ["submitting"] });
  onChain(3);
  const out = await receiptPass({ cli });
  assert.deepEqual(out.issued, [good], "the good batch is issued");
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].batchId, bad);
  assert.match(out.failed[0].code, /^[a-z_]+$/, "a problem code, nothing else");
  assert.deepEqual([receiptsOf(good), receiptsOf(bad)], [3, 0]);
});

test("the loop: passes run one after another, never overlapping; a failing pass is logged and the loop goes on; stop ends it", async () => {
  let active = 0;
  let maxActive = 0;
  let passes = 0;
  const lines: string[] = [];
  const sleeps: number[] = [];
  let release!: () => void;
  const stopped = new Promise<void>((r) => (release = r));
  const worker = startReceiptWorker({
    intervalMs: 5_000,
    pass: async (): Promise<PassResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      passes++;
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (passes === 2) throw Object.assign(new Error("boom"), { code: "store_busy" });
      if (passes === 4) release();
      return { issued: passes === 1 ? ["b-1"] : [], existing: [], failed: passes === 3 ? [{ batchId: "b-2", code: "issuance_failed" }] : [], considered: [], complete: [], voided: [] };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => lines.push(line),
  });
  await stopped;
  await worker.stop();
  const after = passes;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(passes, after, "no pass after stop");
  assert.equal(maxActive, 1, "never two passes at once");
  assert.ok(sleeps.length >= 3 && sleeps.every((ms) => ms === 5_000), "the interval between passes");
  assert.deepEqual(lines.slice(0, 3), ["receipts: issued for batch b-1", "receipts: pass failed (store_busy); retrying next pass", "receipts: batch b-2 not issued (issuance_failed); retrying in 1 pass"]);
});

// Slice I2b (review I2's optional; R88): capped exponential backoff per batch, counted in passes, and a failure logged
// when it starts or its code changes, never on a repeat.
test("backoffPasses: 1, 2, 4, 8, 16, then 32 at most", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 40].map(backoffPasses), [1, 2, 4, 8, 16, 32, 32, 32]);
  assert.equal(MAX_BACKOFF_PASSES, 32);
});

/** Run a worker over a scripted pass until `until` passes ran; returns which passes tried `id` and the log. */
async function scripted(id: string, until: number, outcome: (pass: number) => "issued" | "not_ready" | "complete" | "voided" | string) {
  const lines: string[] = [];
  const tried: number[] = [];
  let n = 0;
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  const worker = startReceiptWorker({
    intervalMs: 60_000,
    pass: async (skip): Promise<PassResult> => {
      n++;
      if (n >= until) release();
      if (skip.has(id)) return { issued: [], existing: [], failed: [], considered: [], complete: [], voided: [] };
      tried.push(n);
      const o = outcome(n);
      if (o === "issued") return { issued: [id], existing: [], failed: [], considered: [id], complete: [], voided: [] };
      if (o === "not_ready") return { issued: [], existing: [], failed: [], considered: [id], complete: [], voided: [] };
      if (o === "complete") return { issued: [], existing: [], failed: [], considered: [id], complete: [id], voided: [] };
      if (o === "voided") return { issued: [], existing: [], failed: [], considered: [id], complete: [], voided: [id] };
      return { issued: [], existing: [], failed: [{ batchId: id, code: o }], considered: [id], complete: [], voided: [] };
    },
    sleep: async () => {},
    log: (line) => lines.push(line),
  });
  await done;
  await worker.stop();
  return { tried: tried.filter((p) => p <= until), lines };
}

test("a batch that keeps failing is tried after 1, 2, 4, 8, 16, 32, 32 passes, and logged once per code", async () => {
  const { tried, lines } = await scripted("b-x", 200, (p) => (p < 40 ? "issuance_failed" : "wallet_unavailable"));
  // Failures at 1, 2, 4, 8, 16, 32 (waits 1, 2, 4, 8, 16, 32), then every 32 passes.
  assert.deepEqual(tried, [1, 2, 4, 8, 16, 32, 64, 96, 128, 160, 192]);
  assert.deepEqual(lines, [
    "receipts: batch b-x not issued (issuance_failed); retrying in 1 pass",
    "receipts: batch b-x not issued (wallet_unavailable); retrying in 32 passes", // pass 64: the code changed, so it is logged
  ]);
});

test("a recovery is logged once with the failed passes, and the record is cleared", async () => {
  const { tried, lines } = await scripted("b-y", 12, (p) => (p <= 4 ? "issuance_failed" : p === 8 ? "issued" : "not_ready"));
  assert.deepEqual(tried, [1, 2, 4, 8, 9, 10, 11, 12], "after the recovery it is looked at every pass again");
  assert.deepEqual(lines, ["receipts: batch b-y not issued (issuance_failed); retrying in 1 pass", "receipts: issued for batch b-y after 3 failed passes"]);
});

test("a batch that stops failing without being issued (not ready, voided, issued by a person) is forgotten: its next failure is new", async () => {
  const { tried, lines } = await scripted("b-z", 8, (p) => (p === 1 || p === 2 ? "issuance_failed" : p === 4 ? "not_ready" : "issuance_failed"));
  // 1 fails (wait 1), 2 fails (wait 2), 4 not failing (forgotten), 5 fails as a first failure (wait 1), 6 (wait 2), 8.
  assert.deepEqual(tried, [1, 2, 4, 5, 6, 8]);
  assert.deepEqual(lines, ["receipts: batch b-z not issued (issuance_failed); retrying in 1 pass", "receipts: batch b-z not issued (issuance_failed); retrying in 1 pass"]);
});

test("receiptPass({skip}): a skipped batch is not looked at, so the wallet is not asked about it; the others are issued", async () => {
  const id = await scenario("i2b-skip", { broadcast: "broadcast" });
  onChain(3);
  const before = fake.requests;
  assert.deepEqual(await receiptPass({ cli, skip: new Set([id]) }), { issued: [], existing: [], failed: [], considered: [], complete: [], voided: [] });
  assert.equal(fake.requests, before, "no wallet request for a skipped batch");
  assert.equal(receiptsOf(id), 0);
  assert.deepEqual((await receiptPass({ cli })).issued, [id], "not skipped: issued");
});

// Slice I2c (review I2b's optional): a failing batch that someone else completes or voids is said once, then forgotten.
test("a failing batch then completed by a person: one line naming the failed passes, then nothing", async () => {
  const { tried, lines } = await scripted("b-c", 8, (p) => (p <= 2 ? "issuance_failed" : "complete"));
  assert.deepEqual(tried, [1, 2, 4, 5, 6, 7, 8], "complete from pass 4: looked at every pass again");
  assert.deepEqual(lines, ["receipts: batch b-c not issued (issuance_failed); retrying in 1 pass", "receipts: batch b-c was completed elsewhere after 2 failed passes"]);
});

test("a failing batch then voided: one line, no longer tried; a batch complete from the start logs nothing", async () => {
  const voided = await scripted("b-v", 5, (p) => (p === 1 ? "wallet_unavailable" : "voided"));
  assert.deepEqual(voided.lines, ["receipts: batch b-v not issued (wallet_unavailable); retrying in 1 pass", "receipts: batch b-v was voided after 1 failed pass; no longer tried"]);
  const quiet = await scripted("b-q", 4, () => "complete");
  assert.deepEqual(quiet.lines, [], "no noise from batches that never failed");
});
