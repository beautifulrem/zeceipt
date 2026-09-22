import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileIdempotencyStore,
  migrateDb,
  openDb,
  MemoryIdempotencyStore,
  NonceConflictError,
  PaymentRejectedError,
  PreflightFailedError,
  StoreBusyError,
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
      { payableId: "z", address: R[2], zat: 1n, memo: "" },
    ],
  };
  const pre = await b.preflight(bad);
  assert.equal(pre.ok, false);
  const codes = pre.problems.map((p) => p.code).sort();
  assert.deepEqual(codes, ["address_checksum", "address_hrp", "amount_nonpositive", "duplicate_payable", "insufficient_funds", "memo_duplicate", "memo_empty", "memo_too_long"]);
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

test("pre-build refusal (known Zkool message) → failed_retryable; retry with the same nonce pays once", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.nextPay = "refused";
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

test("GraphQL error after the tx reached the node → unknown_outcome, never re-paid, reconciled once mined", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.nextPay = "grpc-error-sent";
  await assert.rejects(b.submit(batch("gsent"), "nonce-gsent"), UnknownOutcomeError);
  const rec = await store.get("nonce-gsent");
  assert.equal(rec?.state, "unknown_outcome");
  assert.equal(rec?.expiresBy, fake.height + 50);
  await assert.rejects(b.submit(batch("gsent"), "nonce-gsent"), /cannot be mined after height/);
  assert.equal(fake.payCalls, calls + 1);
  fake.mine();
  const got = await b.submit(batch("gsent"), "nonce-gsent");
  assert.deepEqual([got.via, got.txid, fake.payCalls], ["reconciled", fake.mined.at(-1)!.txid, calls + 1]);
});

for (const mode of ["grpc-error-unsent", "node-rejected"] as const) {
  test(`${mode}: uncertain until the attempt's expiry bound passes, then the same nonce pays exactly once more`, async () => {
    const store = new MemoryIdempotencyStore();
    const b = backend({ store });
    const calls = fake.payCalls;
    fake.nextPay = mode;
    await assert.rejects(b.submit(batch(mode), `nonce-${mode}`), UnknownOutcomeError);
    const bound = (await store.get(`nonce-${mode}`))!.expiresBy!;
    assert.equal(bound, fake.height + 50);
    fake.advance(50); // tip == bound (40 expiry + 10 margin): still treated as possibly minable
    await assert.rejects(b.submit(batch(mode), `nonce-${mode}`), UnknownOutcomeError);
    assert.equal(fake.payCalls, calls + 1);
    fake.advance(1); // tip > bound and nothing matching was mined: the attempt can never be mined
    const got = await b.submit(batch(mode), `nonce-${mode}`);
    assert.deepEqual([got.via, got.replayed, fake.payCalls], ["fresh", false, calls + 2]);
    assert.equal((await store.get(`nonce-${mode}`))?.attempts, 2);
    assert.deepEqual(await b.submit(batch(mode), `nonce-${mode}`), { txid: got.txid, replayed: true, via: "record" });
    assert.equal(fake.payCalls, calls + 2);
    fake.mine();
  });
}

test("reconciliation requires the batch's addresses, not just its memos and values", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  fake.nextPay = "drop-after-broadcast";
  await assert.rejects(b.submit(batch("addr"), "nonce-addr"), UnknownOutcomeError);
  // The broadcast is lost; another issuer tx pays the same memos and values to other addresses.
  fake.drop();
  const other = batch("addr").items.map((it) => ({ address: R[(R.indexOf(it.address) + 1) % 3], amount: `${it.zat / 100_000_000n}.${(it.zat % 100_000_000n).toString().padStart(8, "0")}`, memo: it.memo }));
  fake.height += 1;
  fake.mined.push({ txid: "cd".repeat(32), height: fake.height, expiry: fake.height + 40, recipients: other });
  await assert.rejects(b.submit(batch("addr"), "nonce-addr"), /no mined transaction of the issuer pays this batch/);
  assert.equal((await store.get("nonce-addr"))?.state, "unknown_outcome");
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
  assert.deepEqual(await b.status("ab".repeat(32)).then((x) => [x.state, x.state === "unknown" && x.cause]), ["unknown", "not_ours"]);
  assert.deepEqual(await b.status("nothex").then((x) => [x.state, x.state === "unknown" && x.cause]), ["unknown", "malformed_txid"]);
  const { txid: t2 } = await b.submit(batch("st2"), "nonce-st2");
  clock = new Date(clock.getTime() + 120_000);
  const late = await b.status(t2);
  assert.equal(late.state, "unknown");
  if (late.state === "unknown") assert.equal(late.cause, "timeout");
  fake.mine();
});

test("status: a broadcast that was never mined is reported expired once the tip passes its bound", async () => {
  const b = backend();
  const { txid } = await b.submit(batch("exp"), "nonce-exp");
  assert.equal((await b.status(txid)).state, "pending");
  fake.drop();
  fake.advance(51);
  const st = await b.status(txid);
  assert.equal(st.state, "unknown");
  if (st.state === "unknown") assert.match(st.reason, /expired: not mined by height/);
  if (st.state === "unknown") assert.equal(st.cause, "expired");
});

for (const kind of ["file", "sqlite"] as const) {
  test(`${kind} store: two OS processes racing on one nonce → exactly one payment`, async () => {
    const d = join(dir, `two-procs-${kind}`);
    let spec = `file:${d}`;
    if (kind === "sqlite") {
      await mkdir(d, { recursive: true });
      const db = openDb({ path: join(d, "console.db") });
      migrateDb(db); // migrate once before serving, as in production
      db.$client.close();
      spec = `sqlite:${join(d, "console.db")}`;
    }
    const calls = fake.payCalls;
    fake.payDelayMs = 400;
    const b = JSON.stringify(batch(`procs-${kind}`), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const child = join(import.meta.dirname, "helpers/submit-child.ts");
    const runChild = () => promisify(execFile)(process.execPath, [child, fake.url, spec, `nonce-procs-${kind}`, b]).then((r) => JSON.parse(r.stdout));
    const [x, y] = await Promise.all([runChild(), runChild()]);
    fake.payDelayMs = 0;
    assert.equal(fake.payCalls, calls + 1, "only one process may call pay");
    const outcomes = [x, y].map((o) => (o.ok ? "paid" : o.code)).sort();
    assert.deepEqual(outcomes, ["in_flight", "paid"]);
    // A third process replays the recorded txid.
    const z = await runChild();
    assert.deepEqual([z.ok, z.replayed, z.via, fake.payCalls], [true, true, "record", calls + 1]);
    fake.mine();
  });
}

test("a sync that did not scan (Zkool's lock held elsewhere) never licenses a second payment", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.nextPay = "grpc-error-sent";
  await assert.rejects(b.submit(batch("lag"), "nonce-lag"), UnknownOutcomeError);
  const bound = (await store.get("nonce-lag"))!.expiresBy!;
  fake.syncBusy = true; // from here on synchronizeAccount answers the tip without scanning
  fake.mine(); // the lost-answer tx is mined inside its expiry…
  fake.advance(bound - fake.height + 2); // …and the node tip moves past the bound, unscanned
  assert.ok(fake.height > bound && fake.scanned <= bound);
  await assert.rejects(b.submit(batch("lag"), "nonce-lag"), /scanned height/);
  assert.equal(fake.payCalls, calls + 1, "no second payment while the account is not scanned past the bound");
  fake.syncBusy = false;
  const got = await b.submit(batch("lag"), "nonce-lag");
  assert.deepEqual([got.via, fake.payCalls], ["reconciled", calls + 1]);
});

test("status never calls an unscanned mined tx expired", async () => {
  const b = backend();
  const { txid } = await b.submit(batch("lagst"), "nonce-lagst");
  fake.syncBusy = true;
  fake.mine();
  fake.advance(55); // node tip past the bound (tip + 50), account not scanned
  const st = await b.status(txid);
  assert.equal(st.state, "pending");
  fake.syncBusy = false;
  const mined = await b.status(txid);
  assert.equal(mined.state, "mined");
});

test("resubmitExpired: only after the account is scanned past the bound with nothing mined; exactly one new payment", async () => {
  const b = backend();
  const calls = fake.payCalls;
  const first = await b.submit(batch("resend"), "nonce-resend");
  await assert.rejects(b.resubmitExpired(batch("resend"), "nonce-resend"), /can still be mined/);
  fake.drop(); // the node lost it
  fake.advance(51);
  assert.match((await b.status(first.txid) as { reason: string }).reason, /expired/);
  assert.deepEqual(await b.submit(batch("resend"), "nonce-resend"), { txid: first.txid, replayed: true, via: "record" }); // submit alone never re-pays
  const again = await b.resubmitExpired(batch("resend"), "nonce-resend");
  assert.notEqual(again.txid, first.txid);
  assert.equal(fake.payCalls, calls + 2);
  await assert.rejects(b.resubmitExpired(batch("resend"), "nonce-resend"), /can still be mined/);
  assert.match((await b.status(first.txid) as { reason: string }).reason, /superseded/);
  assert.equal((await b.status(first.txid) as { cause: string }).cause, "superseded");
  fake.mine();
  assert.equal((await b.status(again.txid)).state, "mined");
  await assert.rejects(b.resubmitExpired(batch("resend"), "nonce-resend"), /was mined/);
});

test("inFlightMs must exceed the longest attempt (pay timeout + 3 request timeouts)", () => {
  const client = new ZkoolClient({ url: fake.url, timeoutMs: 60_000, payTimeoutMs: 300_000 });
  assert.throws(() => new ZkoolBackend({ client, account: 9, store: new MemoryIdempotencyStore(), inFlightMs: 400_000 }), RangeError);
  assert.doesNotThrow(() => new ZkoolBackend({ client, account: 9, store: new MemoryIdempotencyStore() }));
});

test("a dead retry claimer cannot wedge a nonce: its stale claim and stale lock are recovered, one payment", async () => {
  const d = join(dir, "wedge");
  const store = new FileIdempotencyStore(d, { staleLockMs: 200 });
  const b = backend({ store, inFlightMs: 10_000 });
  const calls = fake.payCalls;
  fake.nextPay = "refused";
  await assert.rejects(b.submit(batch("wedge"), "nonce-wedge"), PaymentRejectedError);
  // A retrier claimed attempt 2, then died holding the record lock before it could advance the record.
  assert.equal(await store.claimAttempt("nonce-wedge", 2, 10_000), true);
  const { createHash } = await import("node:crypto");
  const k = createHash("sha256").update("nonce-wedge").digest("hex");
  const old = new Date(Date.now() - 60_000);
  await utimes(join(d, `${k}.attempt-2`), old, old);
  await writeFile(join(d, `${k}.lock`), "");
  await utimes(join(d, `${k}.lock`), old, old);
  const got = await b.submit(batch("wedge"), "nonce-wedge");
  assert.deepEqual([got.via, fake.payCalls], ["fresh", calls + 2]);
  assert.equal((await store.get("nonce-wedge"))?.attempts, 2);
  // A live (recent) claim is still respected.
  assert.equal(await store.claimAttempt("nonce-wedge", 3, 10_000), true);
  assert.equal(await store.claimAttempt("nonce-wedge", 3, 10_000), false);
  fake.mine();
});

test("file store: a lock renewed by a live writer ends in StoreBusyError; a stale lock broken by many waiters admits one CAS winner", async () => {
  const d = join(dir, "busy");
  const store = new FileIdempotencyStore(d, { staleLockMs: 300, lockWaitMs: 400 });
  const base = { nonce: "n-busy", batchId: "b", batchDigest: "d", createdAt: "t", state: "submitting" as const, attempts: 1 };
  await store.createIntent(base);
  const { createHash } = await import("node:crypto");
  const lock = join(d, `${createHash("sha256").update("n-busy").digest("hex")}.lock`);
  await writeFile(lock, "");
  const renew = setInterval(() => void utimes(lock, new Date(), new Date()).catch(() => {}), 20);
  await assert.rejects(store.update({ ...base, state: "broadcast" }, { attempts: 1, states: ["submitting"] }), StoreBusyError);
  clearInterval(renew);
  for (let round = 0; round < 10; round++) {
    const old = new Date(Date.now() - 10_000);
    await writeFile(lock, "");
    await utimes(lock, old, old);
    const cur = (await store.get("n-busy"))!;
    const wins = await Promise.all([...Array(8)].map((_, i) => store.update({ ...cur, attempts: cur.attempts + 1, error: String(i) }, { attempts: cur.attempts, states: ["submitting"] })));
    assert.equal(wins.filter(Boolean).length, 1, `round ${round}`);
  }
});

test("a store failure right after a successful pay surfaces as UnknownOutcomeError and is reconciled later", async () => {
  class FlakyStore extends MemoryIdempotencyStore {
    failBroadcast = true;
    override async update(next: Parameters<MemoryIdempotencyStore["update"]>[0], expect: Parameters<MemoryIdempotencyStore["update"]>[1]) {
      if (this.failBroadcast && next.state === "broadcast") throw new StoreBusyError("disk full");
      return super.update(next, expect);
    }
  }
  let clock = new Date("2026-09-23T12:00:00Z");
  const store = new FlakyStore();
  const b = backend({ store, now: () => clock, inFlightMs: 60_000 });
  const calls = fake.payCalls;
  await assert.rejects(b.submit(batch("flaky"), "nonce-flaky"), (e: unknown) => e instanceof UnknownOutcomeError && /recording it failed/.test((e as Error).message));
  store.failBroadcast = false;
  await assert.rejects(b.submit(batch("flaky"), "nonce-flaky"), SubmissionInFlightError); // record still `submitting`, young
  fake.mine();
  clock = new Date(clock.getTime() + 120_000);
  const got = await b.submit(batch("flaky"), "nonce-flaky");
  assert.deepEqual([got.via, fake.payCalls], ["reconciled", calls + 1]);
});

test("status tells an interrupted record write apart from a superseded attempt", async () => {
  const d = join(dir, "interrupted");
  const store = new FileIdempotencyStore(d);
  const b = backend({ store });
  await store.createIntent({ nonce: "n-int", batchId: "b", batchDigest: "d", createdAt: new Date().toISOString(), state: "submitting", attempts: 1 });
  const txid = "ef".repeat(32);
  await writeFile(join(d, `${txid}.txid`), "n-int\n1"); // index written, record write lost
  const st = await b.status(txid);
  assert.equal(st.state, "unknown");
  if (st.state === "unknown") assert.match(st.reason, /interrupted write/);
  if (st.state === "unknown") assert.equal(st.cause, "interrupted");
});

test("resubmitExpired records a fallback bound when the post-pay bound request failed, instead of refusing forever", async () => {
  const store = new MemoryIdempotencyStore();
  const b = backend({ store });
  const calls = fake.payCalls;
  fake.failCurrentHeight = true;
  const first = await b.submit(batch("nobound"), "nonce-nobound");
  fake.failCurrentHeight = false;
  assert.equal((await store.get("nonce-nobound"))?.expiresBy, undefined);
  fake.drop();
  await assert.rejects(b.resubmitExpired(batch("nobound"), "nonce-nobound"), /now recorded as/);
  const bound = (await store.get("nonce-nobound"))!.expiresBy!;
  assert.equal(bound, fake.height + 50);
  fake.advance(51);
  const again = await b.resubmitExpired(batch("nobound"), "nonce-nobound");
  assert.notEqual(again.txid, first.txid);
  assert.equal(fake.payCalls, calls + 2);
  fake.mine();
});

test("file store lease: a writer suspended past staleLockMs loses the lock and writes nothing over the new holder", async () => {
  const d = join(dir, "lease");
  class SlowStore extends FileIdempotencyStore {
    pauseMs = 0;
    override async get(nonce: string) {
      const r = await super.get(nonce);
      if (this.pauseMs) await new Promise((res) => setTimeout(res, this.pauseMs)); // "suspended" inside update
      return r;
    }
  }
  const a = new SlowStore(d, { staleLockMs: 100 });
  const b2 = new FileIdempotencyStore(d, { staleLockMs: 100 });
  const base = { nonce: "n-lease", batchId: "b", batchDigest: "d", createdAt: "t", state: "submitting" as const, attempts: 1 };
  await a.createIntent(base);
  a.pauseMs = 400;
  const slow = a.update({ ...base, attempts: 2, error: "A" }, { attempts: 1, states: ["submitting"] });
  await new Promise((res) => setTimeout(res, 200)); // A holds a lock that is now stale
  assert.equal(await b2.update({ ...base, attempts: 2, error: "B" }, { attempts: 1, states: ["submitting"] }), true);
  await assert.rejects(slow, StoreBusyError);
  assert.equal((await b2.get("n-lease"))?.error, "B");
});

test("file store: temp files left by a crash are swept once older than staleLockMs; fresh ones are kept", async () => {
  const d = join(dir, "sweep");
  const store = new FileIdempotencyStore(d, { staleLockMs: 1_000 });
  await store.createIntent({ nonce: "n-sweep", batchId: "b", batchDigest: "d".repeat(64), createdAt: "t", state: "submitting", attempts: 1 });
  const stale = join(d, `${"a".repeat(64)}.txid.deadbeef.tmp`);
  const fresh = join(d, `${"b".repeat(64)}.txid.cafebabe.tmp`);
  await writeFile(stale, "n-x\n1");
  await writeFile(fresh, "n-y\n1");
  const old = new Date(Date.now() - 60_000);
  await utimes(stale, old, old);
  assert.equal(await store.update({ nonce: "n-sweep", batchId: "b", batchDigest: "d".repeat(64), createdAt: "t", state: "broadcast", txid: "c".repeat(64), attempts: 1 }, { attempts: 1, states: ["submitting"] }), true);
  const { readdir } = await import("node:fs/promises");
  const left = (await readdir(d)).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(left, [`${"b".repeat(64)}.txid.cafebabe.tmp`]);
  assert.equal((await store.findByTxid("c".repeat(64)))?.record.nonce, "n-sweep");
});

test("file store lease: a holder suspended after its write does not delete the next holder's lock", async () => {
  const d = join(dir, "lease-exit");
  const a = new FileIdempotencyStore(d, { staleLockMs: 100 });
  const base = { nonce: "n-exit", batchId: "b", batchDigest: "d", createdAt: "t", state: "submitting" as const, attempts: 1 };
  await a.createIntent(base);
  const { createHash } = await import("node:crypto");
  const lock = join(d, `${createHash("sha256").update("n-exit").digest("hex")}.lock`);
  // Simulate the next holder's lock appearing after A's write but before A's exit cleanup.
  const origWrite = (a as unknown as { writeAtomic: (p: string, b: string) => Promise<void> }).writeAtomic.bind(a);
  (a as unknown as { writeAtomic: (p: string, b: string) => Promise<void> }).writeAtomic = async (p: string, body: string) => {
    await origWrite(p, body);
    if (p.endsWith(".json")) {
      await rm(lock);
      await writeFile(lock, "B");
    }
  };
  assert.equal(await a.update({ ...base, attempts: 2 }, { attempts: 1, states: ["submitting"] }), true);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(lock, "utf8"), "B", "the other holder's lock must survive");
});
