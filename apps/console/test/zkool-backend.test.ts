import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileIdempotencyStore,
  MemoryIdempotencyStore,
  NonceConflictError,
  PaymentRejectedError,
  PreflightFailedError,
  SubmissionInFlightError,
  UnknownOutcomeError,
  ZkoolBackend,
  ZkoolClient,
  type Batch,
} from "../lib/index.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";

const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
const batch = (id = "b1"): Batch => ({
  id,
  network: "regtest",
  items: [
    { payableId: "p-2", address: R[0], zat: 101_000_000n, memo: `${id}-INV-002` },
    { payableId: "p-3", address: R[1], zat: 102_000_000n, memo: `${id}-INV-003` },
    { payableId: "p-4", address: R[2], zat: 103_000_000n, memo: `${id}-INV-004` },
  ],
});

let fake: FakeZkool;
let dir: string;
before(async () => {
  fake = await new FakeZkool().start();
  dir = await mkdtemp(join(tmpdir(), "zeceipt-idem-"));
});
after(async () => {
  await fake.stop();
  await rm(dir, { recursive: true, force: true });
});

function backend(opts: Partial<ConstructorParameters<typeof ZkoolBackend>[0]> = {}) {
  return new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 }), account: 9, store: new MemoryIdempotencyStore(), ...opts });
}

test("client refuses non-loopback endpoints unless allowed", () => {
  assert.throws(() => new ZkoolClient({ url: "http://10.0.0.5:9000/graphql" }), /non-loopback/);
  assert.doesNotThrow(() => new ZkoolClient({ url: "http://10.0.0.5:9000/graphql", allowRemote: true }));
});

test("preflight reports every problem at once and never pays", async () => {
  const b = backend();
  const calls = fake.payCalls;
  const bad: Batch = {
    id: "bad",
    network: "regtest",
    items: [
      { payableId: "x", address: R[0].replace("uregtest1", "utest1"), zat: 0n, memo: "m".repeat(513) },
      { payableId: "x", address: R[1].slice(0, -2) + "qq", zat: 20_000_000_000n, memo: "dup" },
      { payableId: "y", address: R[2], zat: 1n, memo: "dup" },
    ],
  };
  const pre = await b.preflight(bad);
  assert.equal(pre.ok, false);
  const codes = pre.problems.map((p) => p.code).sort();
  assert.deepEqual(codes, ["address_checksum", "address_hrp", "amount_nonpositive", "duplicate_payable", "insufficient_funds", "memo_duplicate", "memo_too_long"]);
  assert.equal(fake.payCalls, calls);
  assert.equal((await b.preflight(batch())).ok, true);
  assert.deepEqual((await b.preflight({ id: "e", network: "regtest", items: [] })).problems.map((p) => p.code), ["empty_batch"]);
});

test("submit is idempotent per nonce: same nonce twice → one pay, same txid", async () => {
  const b = backend();
  const calls = fake.payCalls;
  const first = await b.submit(batch("idem"), "nonce-idem");
  const second = await b.submit(batch("idem"), "nonce-idem");
  assert.equal(fake.payCalls, calls + 1);
  assert.deepEqual(first, { txid: first.txid, replayed: false, via: "fresh" });
  assert.deepEqual(second, { txid: first.txid, replayed: true, via: "record" });
});

test("same nonce with a different batch is rejected", async () => {
  const b = backend();
  await b.submit(batch("conf"), "nonce-conf");
  const other = batch("conf");
  other.items[0].zat += 1n;
  await assert.rejects(b.submit(other, "nonce-conf"), NonceConflictError);
});

test("concurrent submits with one nonce: exactly one pays, the other is told it is in flight", async () => {
  const b = backend();
  const calls = fake.payCalls;
  fake.payDelayMs = 200;
  const results = await Promise.allSettled([b.submit(batch("race"), "nonce-race"), b.submit(batch("race"), "nonce-race")]);
  fake.payDelayMs = 0;
  assert.equal(fake.payCalls, calls + 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rej = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(rej.reason instanceof SubmissionInFlightError);
});

test("file store: exclusive intent across two store instances in one process, and replay after a restart", async () => {
  const d = join(dir, "shared");
  const a = backend({ store: new FileIdempotencyStore(d) });
  const c = backend({ store: new FileIdempotencyStore(d) });
  const calls = fake.payCalls;
  fake.payDelayMs = 200;
  const results = await Promise.allSettled([a.submit(batch("xproc"), "nonce-xproc"), c.submit(batch("xproc"), "nonce-xproc")]);
  fake.payDelayMs = 0;
  assert.equal(fake.payCalls, calls + 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const restarted = backend({ store: new FileIdempotencyStore(d) });
  const again = await restarted.submit(batch("xproc"), "nonce-xproc");
  assert.equal(again.replayed, true);
  assert.equal(fake.payCalls, calls + 1);
});

test("GraphQL refusal → failed_retryable; retry with the same nonce pays once", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.nextPay = "graphql-error";
  await assert.rejects(b.submit(batch("rej"), "nonce-rej"), PaymentRejectedError);
  assert.equal((await store.get("nonce-rej"))?.state, "failed_retryable");
  const ok = await b.submit(batch("rej"), "nonce-rej");
  assert.equal(ok.via, "fresh");
  assert.equal(fake.payCalls, calls + 2);
  assert.equal((await store.get("nonce-rej"))?.attempts, 2);
});

test("preflight failure inside submit leaves the nonce retryable and sends nothing", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  const big = batch("poor");
  big.items[0].zat = 50_000_000_000n;
  await assert.rejects(b.submit(big, "nonce-poor"), PreflightFailedError);
  assert.equal(fake.payCalls, calls);
  assert.equal((await store.get("nonce-poor"))?.state, "failed_retryable");
});

test("transport failure after broadcast → unknown_outcome; never re-pays; reconciles once mined", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.nextPay = "drop-after-broadcast";
  await assert.rejects(b.submit(batch("lost"), "nonce-lost"), UnknownOutcomeError);
  assert.equal((await store.get("nonce-lost"))?.state, "unknown_outcome");
  // Not mined yet: still unknown, and no second payment.
  await assert.rejects(b.submit(batch("lost"), "nonce-lost"), UnknownOutcomeError);
  assert.equal(fake.payCalls, calls + 1);
  fake.mine();
  const got = await b.submit(batch("lost"), "nonce-lost");
  assert.equal(got.via, "reconciled");
  assert.equal(got.txid, fake.mined.at(-1)!.txid);
  assert.equal(fake.payCalls, calls + 1);
  assert.equal((await store.get("nonce-lost"))?.state, "broadcast");
});

test("pay timeout → unknown_outcome (the backend may still broadcast)", async () => {
  const store = new MemoryIdempotencyStore();
  const b = new ZkoolBackend({ client: new ZkoolClient({ url: fake.url, payTimeoutMs: 300 }), account: 9, store });
  fake.nextPay = "hang";
  await assert.rejects(b.submit(batch("hang"), "nonce-hang"), UnknownOutcomeError);
  assert.equal((await store.get("nonce-hang"))?.state, "unknown_outcome");
  fake.mine(); // the hung pay did create a tx; clear it so later tests see a clean mempool
});

test("a stale 'submitting' record is resolved by reconciliation, a fresh one is in flight", async () => {
  let clock = new Date("2026-09-23T00:00:00Z");
  const store = new MemoryIdempotencyStore();
  const b = backend({ store, now: () => clock, inFlightMs: 60_000 });
  await store.createIntent({ nonce: "nonce-stale", batchId: "stale", batchDigest: (await import("../lib/index.ts")).batchDigest(batch("stale")), state: "submitting", createdAt: clock.toISOString(), attempts: 1 });
  await assert.rejects(b.submit(batch("stale"), "nonce-stale"), SubmissionInFlightError);
  clock = new Date(clock.getTime() + 120_000);
  await assert.rejects(b.submit(batch("stale"), "nonce-stale"), UnknownOutcomeError);
});

test("status: pending → mined with confirmations; unknown after timeout or for foreign txids", async () => {
  let clock = new Date("2026-09-23T10:00:00Z");
  const b = backend({ now: () => clock, pendingTimeoutMs: 60_000 });
  const { txid } = await b.submit(batch("st"), "nonce-st");
  assert.deepEqual(await b.status(txid), { state: "pending", broadcastAt: clock.toISOString() });
  fake.mine(2);
  const mined = await b.status(txid);
  assert.equal(mined.state, "mined");
  if (mined.state === "mined") assert.equal(mined.confirmations, 3);
  assert.equal((await b.status("ab".repeat(32))).state, "unknown");
  assert.equal((await b.status("nothex")).state, "unknown");
  const { txid: t2 } = await b.submit(batch("st2"), "nonce-st2");
  clock = new Date(clock.getTime() + 120_000);
  const late = await b.status(t2);
  assert.equal(late.state, "unknown");
  fake.mine();
});

test("file store: two OS processes racing on one nonce → exactly one payment", async () => {
  const d = join(dir, "two-procs");
  const calls = fake.payCalls;
  fake.payDelayMs = 400;
  const b = JSON.stringify(batch("procs"), (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const child = join(import.meta.dirname, "helpers/submit-child.ts");
  const runChild = () => promisify(execFile)(process.execPath, [child, fake.url, d, "nonce-procs", b]).then((r) => JSON.parse(r.stdout));
  const [x, y] = await Promise.all([runChild(), runChild()]);
  fake.payDelayMs = 0;
  assert.equal(fake.payCalls, calls + 1, "only one process may call pay");
  const outcomes = [x, y].map((o) => (o.ok ? "paid" : o.code)).sort();
  assert.deepEqual(outcomes, ["in_flight", "paid"]);
  fake.mine();
});
