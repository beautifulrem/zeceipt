// Derived batch status (slice B3): the status table row by row (pure), and the reader end to end —
// with the fake Zkool (draft → pending → confirming → confirmed) and with the real fixture transaction
// and real receipts (confirmed → receipts_issued). The status is never stored.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  autoIssue,
  batchDigest,
  batchNonce,
  createBatch,
  deriveBatchStatus,
  getBatchStatus,
  Keyring,
  migrateDb,
  openDb,
  recordReceipts,
  SqliteIdempotencyStore,
  toExecutionBatch,
  ZkoolBackend,
  ZkoolClient,
  type AutoIssueResult,
  type BatchFacts,
  type ConsoleDb,
  type SubmissionRecord,
  type TxStatus,
} from "../lib/index.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";

const NOW = new Date("2026-09-23T12:00:00Z");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const sub = (state: SubmissionRecord["state"], over: Partial<SubmissionRecord> = {}): SubmissionRecord => ({
  nonce: "batch/x",
  batchId: "x",
  batchDigest: "a".repeat(64),
  state,
  createdAt: "2026-09-23T11:59:00Z",
  attempts: 1,
  ...(state === "broadcast" ? { txid: TXID } : {}),
  ...over,
});
const mined = (confirmations: number): TxStatus => ({ state: "mined", height: 100, confirmations, tip: 99 + confirmations });
const unknown = (cause: Extract<TxStatus, { state: "unknown" }>["cause"]): TxStatus => ({ state: "unknown", cause, reason: cause });
const facts = (over: Partial<BatchFacts>): BatchFacts => ({ itemCount: 3, receipts: 0, requiredConfirmations: 2, now: NOW, inFlightMs: 600_000, ...over });

test("the status table, row by row (design §3.3.1.3.4.2)", () => {
  const rows: [string, Partial<BatchFacts>, string, string][] = [
    ["no submission", {}, "draft", "submit"],
    ["submitting, young", { submission: sub("submitting") }, "submitting", "wait"],
    ["submitting, stale", { submission: sub("submitting", { createdAt: "2026-09-23T11:40:00Z" }) }, "needs_attention", "submit"],
    ["failed_retryable", { submission: sub("failed_retryable", { error: "No feasible note selection found" }) }, "retryable", "submit"],
    ["unknown_outcome", { submission: sub("unknown_outcome", { expiresBy: 150 }) }, "needs_attention", "submit"],
    ["broadcast, pending", { submission: sub("broadcast"), chain: { state: "pending", broadcastAt: "t" } }, "pending", "wait"],
    ["broadcast, 1 of 2", { submission: sub("broadcast"), chain: mined(1) }, "confirming", "wait"],
    ["broadcast, confirmed, no receipts", { submission: sub("broadcast"), chain: mined(2) }, "confirmed", "issue_receipts"],
    ["broadcast, confirmed, 1 of 3 receipts", { submission: sub("broadcast"), chain: mined(5), receipts: 1 }, "receipts_partial", "issue_receipts"],
    ["broadcast, confirmed, all receipts", { submission: sub("broadcast"), chain: mined(2), receipts: 3 }, "receipts_issued", "none"],
    ["broadcast, expired", { submission: sub("broadcast", { expiresBy: 150 }), chain: unknown("expired") }, "expired", "resend_expired"],
    ["broadcast, timeout, bound recorded", { submission: sub("broadcast", { expiresBy: 150 }), chain: unknown("timeout") }, "needs_attention", "wait"],
    ["broadcast, timeout, no bound", { submission: sub("broadcast"), chain: unknown("timeout") }, "needs_attention", "record_expiry"],
    ["broadcast, superseded", { submission: sub("broadcast"), chain: unknown("superseded") }, "needs_attention", "investigate"],
    ["broadcast, interrupted", { submission: sub("broadcast"), chain: unknown("interrupted") }, "needs_attention", "investigate"],
    ["broadcast, not ours", { submission: sub("broadcast"), chain: unknown("not_ours") }, "needs_attention", "investigate"],
    ["broadcast, malformed", { submission: sub("broadcast"), chain: unknown("malformed_txid") }, "needs_attention", "investigate"],
  ];
  for (const [what, f, state, next] of rows) {
    const s = deriveBatchStatus(facts(f));
    assert.deepEqual([s.state, s.next], [state, next], what);
  }
});

test("edges: exactly N confirmations, exactly inFlightMs, receipts before confirmation stay fail-closed, details", () => {
  assert.equal(deriveBatchStatus(facts({ submission: sub("broadcast"), chain: mined(2) })).state, "confirmed");
  assert.equal(deriveBatchStatus(facts({ submission: sub("submitting", { createdAt: new Date(NOW.getTime() - 600_000).toISOString() }) })).state, "needs_attention");
  assert.equal(deriveBatchStatus(facts({ submission: sub("submitting", { createdAt: new Date(NOW.getTime() - 599_999).toISOString() }) })).state, "submitting");
  // Receipts cannot legitimately exist before confirmation; if some do, the state still does not advance.
  assert.equal(deriveBatchStatus(facts({ submission: sub("broadcast"), chain: mined(1), receipts: 3 })).state, "confirming");
  assert.equal(deriveBatchStatus(facts({ submission: sub("broadcast"), chain: { state: "pending", broadcastAt: "t" }, receipts: 3 })).state, "pending");
  assert.deepEqual(deriveBatchStatus(facts({ submission: sub("broadcast"), chain: mined(1) })).detail, { txid: TXID, confirmations: 1, required: 2 });
  assert.deepEqual(deriveBatchStatus(facts({ submission: sub("unknown_outcome", { error: "lost", expiresBy: 150 }) })).detail, { error: "lost", expiresBy: 150 });
  assert.throws(() => deriveBatchStatus(facts({ submission: sub("broadcast") })), RangeError, "a broadcast batch needs its chain status");
});

let dir: string;
let db: ConsoleDb;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-b3-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
const PAYEES = [
  { payableId: "p-2", address: R[0], zat: 101_000_000n, memo: "INV-R-002" },
  { payableId: "p-3", address: R[1], zat: 102_000_000n, memo: "INV-R-003" },
  { payableId: "p-4", address: R[2], zat: 103_000_000n, memo: "INV-R-004" },
];

test("reader end to end with the fake Zkool: draft → pending → confirming → confirmed, never stored", async () => {
  const fake = await new FakeZkool().start();
  try {
    const org = "org-b3";
    const rec = await createBatch(db, { orgId: org, network: "regtest", title: "status", items: PAYEES.map((p) => ({ ...p, memo: `${p.memo}-s` })) });
    const store = new SqliteIdempotencyStore(db, { orgId: org });
    const backend = new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 }), account: 9, store });
    const read = () => getBatchStatus(db, backend, org, rec.id, { requiredConfirmations: 3 }).then((s) => [s?.state, s?.next]);
    assert.deepEqual(await read(), ["draft", "submit"]);
    await backend.submit(toExecutionBatch(rec), batchNonce(rec));
    assert.deepEqual(await read(), ["pending", "wait"]);
    fake.mine();
    assert.deepEqual(await read(), ["confirming", "wait"]);
    fake.mine(2);
    assert.deepEqual(await read(), ["confirmed", "issue_receipts"]);
    assert.equal(await getBatchStatus(db, backend, org, "00000000-0000-7000-8000-000000000000", { requiredConfirmations: 3 }), undefined);
    const cols = (db.$client.prepare("SELECT name FROM pragma_table_info('batches')").all() as { name: string }[]).map((c) => c.name);
    assert.ok(!cols.includes("state"), "the status is derived, not a column");
  } finally {
    await fake.stop();
  }
});

test("with the real fixture transaction and real receipts: confirmed → receipts_issued", async () => {
  const ROOT = resolve(import.meta.dirname, "../../..");
  const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
  const fake = await new FakeZkool().start();
  try {
    const org = "org-b3-fixture";
    const rec = await createBatch(db, { orgId: org, network: "regtest", title: "fixture", items: PAYEES });
    const store = new SqliteIdempotencyStore(db, { orgId: org });
    const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "t", attempts: 1 };
    await store.createIntent({ ...base, state: "submitting" });
    await store.update({ ...base, state: "broadcast", txid: TXID, broadcastAt: NOW.toISOString() }, { attempts: 1, states: ["submitting"] });
    // The fake chain reports the fixture transaction mined with two confirmations.
    fake.height += 1;
    fake.mined.push({ txid: TXID, height: fake.height, expiry: fake.height + 40, recipients: [] });
    fake.height += 1;
    const backend = new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 }), account: 9, store });
    const read = () => getBatchStatus(db, backend, org, rec.id, { requiredConfirmations: 2 });
    assert.deepEqual(await read().then((s) => [s?.state, s?.next]), ["confirmed", "issue_receipts"]);
    const keyFile = join(dir, "issuer.key");
    execFileSync(BIN, ["keygen", "--out", keyFile]);
    const out = await autoIssue({
      batch: toExecutionBatch(rec),
      txid: TXID,
      status: { state: "mined", height: 626, confirmations: 2, tip: 627 },
      requiredConfirmations: 2,
      cli: { bin: BIN, rawTxFile: join(ROOT, `fixtures/regtest-${TXID}.hex`), ufvkFile: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), keyFile, keyId: "2026-09", challenge: "b3" },
    });
    await recordReceipts(db, new Keyring([{ kid: "k1", key: Buffer.alloc(32, 7) }]), { orgId: org, batchId: rec.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });
    const done = await read();
    assert.deepEqual([done?.state, done?.next, done?.detail.receipts, done?.detail.items], ["receipts_issued", "none", 3, 3]);
  } finally {
    await fake.stop();
  }
});

test("a broadcast whose expiry bound was never recorded: record_expiry → (after expiry) expired → resend; never 'wait' forever", async () => {
  const fake = await new FakeZkool().start();
  try {
    const org = "org-b3-nobound";
    const rec = await createBatch(db, { orgId: org, network: "regtest", title: "nobound", items: PAYEES.map((p) => ({ ...p, memo: `${p.memo}-nb` })) });
    const store = new SqliteIdempotencyStore(db, { orgId: org });
    const backend = new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 }), account: 9, store, pendingTimeoutMs: 1 });
    fake.failCurrentHeight = true; // the post-pay bound request fails
    await backend.submit(toExecutionBatch(rec), batchNonce(rec));
    fake.failCurrentHeight = false;
    fake.drop();
    fake.advance(200);
    await new Promise((r) => setTimeout(r, 5)); // past the 1 ms pending timeout
    const read = () => getBatchStatus(db, backend, org, rec.id, { requiredConfirmations: 1 }).then((s) => [s?.state, s?.next]);
    assert.deepEqual(await read(), ["needs_attention", "record_expiry"]);
    const bound = await backend.ensureExpiryBound(batchNonce(rec));
    assert.equal(await backend.ensureExpiryBound(batchNonce(rec)), bound, "idempotent");
    assert.deepEqual(await read(), ["needs_attention", "wait"]);
    fake.advance(bound - fake.height + 1);
    assert.deepEqual(await read(), ["expired", "resend_expired"]);
    await backend.resubmitExpired(toExecutionBatch(rec), batchNonce(rec));
    // Read the new attempt with the default pending timeout (this test's backend uses 1 ms to force "timeout").
    const normal = new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 }), account: 9, store });
    assert.deepEqual(await getBatchStatus(db, normal, org, rec.id, { requiredConfirmations: 1 }).then((x) => [x?.state, x?.next]), ["pending", "wait"]);
  } finally {
    await fake.stop();
  }
});

test("a reader must use the backend's own store: a backend on another org's store yields investigate, never an endless 'submit'", async () => {
  const fake = await new FakeZkool().start();
  try {
    const org = "org-b3-mine";
    const rec = await createBatch(db, { orgId: org, network: "regtest", title: "mine", items: PAYEES.map((p) => ({ ...p, memo: `${p.memo}-m` })) });
    const client = new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 });
    const mine = new ZkoolBackend({ client, account: 9, store: new SqliteIdempotencyStore(db, { orgId: org }) });
    await mine.submit(toExecutionBatch(rec), batchNonce(rec));
    // A misconfigured reader: reads the right record through `store`, but its status() consults another org's index.
    const other = new ZkoolBackend({ client, account: 9, store: new SqliteIdempotencyStore(db, { orgId: "someone-else" }) });
    const mixed = { status: other.status.bind(other), store: mine.store, inFlightMs: mine.inFlightMs };
    const s = await getBatchStatus(db, mixed, org, rec.id, { requiredConfirmations: 1 });
    assert.deepEqual([s?.state, s?.next, s?.detail.cause], ["needs_attention", "investigate", "not_ours"]);
    // The correctly paired reader sees the truth.
    assert.deepEqual(await getBatchStatus(db, mine, org, rec.id, { requiredConfirmations: 1 }).then((x) => x?.state), "pending");
  } finally {
    await fake.stop();
  }
});

test("the reader never combines a submission snapshot with the chain status of a different attempt", async () => {
  const org = "org-b3-torn";
  const rec = await createBatch(db, { orgId: org, network: "regtest", title: "torn", items: PAYEES.map((p) => ({ ...p, memo: `${p.memo}-t` })) });
  const store = new SqliteIdempotencyStore(db, { orgId: org });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: NOW.toISOString(), attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  await store.update({ ...base, state: "broadcast", txid: "aa".repeat(32), broadcastAt: "t" }, { attempts: 1, states: ["submitting"] });
  let calls = 0;
  const source = {
    store,
    inFlightMs: 600_000,
    // While the reader asks about attempt 1's txid, another process starts attempt 2 (e.g. resubmitExpired).
    status: async (txid: string): Promise<TxStatus> => {
      calls++;
      if (txid === "aa".repeat(32)) {
        await store.claimAttempt(base.nonce, 2, 600_000);
        await store.update({ ...base, state: "submitting", attempts: 2, createdAt: NOW.toISOString() }, { attempts: 1, states: ["broadcast"] });
        return unknown("expired");
      }
      return mined(9);
    },
  };
  const s = await getBatchStatus(db, source, org, rec.id, { requiredConfirmations: 1, now: () => NOW });
  assert.deepEqual([s?.state, s?.next], ["submitting", "wait"], "the newer record wins; the stale 'expired' answer is discarded");
  assert.equal(calls, 1);
});
