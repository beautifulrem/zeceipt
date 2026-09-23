// Rate quotes per batch (slice G1b): an append-only history. Round trip and re-lock; no lock once a submission
// froze the batch (an execution quote still records); the schema refuses update, delete, replace and malformed
// values from raw SQL; invalid quotes never reach the database; concurrent writers get distinct consecutive seqs.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  batchDigest, batchNonce, createBatch, currentLock, listQuotes, migrateDb, openDb, RateRecordError, recordQuote,
  SqliteIdempotencyStore, toExecutionBatch, type BatchRecord, type ConsoleDb, type RateQuote,
} from "../lib/index.ts";

const ORG = "org-g1b";
const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
const Q: RateQuote = { source: "kraken", pair: "XZECZUSD", bid: "1616.24000", ask: "1616.97000", last: "1616.34000", rate: "1616.24000", fetchedAt: "2026-09-23T03:40:00.123Z" };
const at = (iso: string) => () => new Date(iso);

let dir: string;
let path: string;
let db: ConsoleDb;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-g1b-"));
  path = join(dir, "console.db");
  db = openDb({ path });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const draft = (tag: string): Promise<BatchRecord> =>
  createBatch(db, { orgId: ORG, network: "regtest", title: `G1b ${tag}`, items: [{ payableId: `${tag}-1`, address: R[0], zat: 1_000n, memo: `INV-${tag}-1` }, { payableId: `${tag}-2`, address: R[1], zat: 2_000n, memo: `INV-${tag}-2` }] });
async function freeze(rec: BatchRecord) {
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  await store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: "t", attempts: 1 });
}
const count = (batchId: string) => (db.$client.prepare("SELECT count(*) AS n FROM rate_quotes WHERE org_id = ? AND batch_id = ?").get(ORG, batchId) as { n: number }).n;

test("a lock is stored exactly; a re-lock becomes current; the history keeps both in order", async () => {
  const b = await draft("rt");
  assert.equal(await currentLock(db, ORG, b.id), undefined, "never locked");
  const first = await recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: Q, now: at("2026-09-23T03:40:01.000Z") });
  assert.deepEqual(first, { seq: 1, purpose: "lock", source: "kraken", pair: "XZECZUSD", bid: "1616.24000", ask: "1616.97000", last: "1616.34000", rate: "1616.24000", fetchedAt: "2026-09-23T03:40:00.123Z", recordedAt: "2026-09-23T03:40:01.000Z" });
  const second = await recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: { ...Q, bid: "1600.5", rate: "1600.5", fetchedAt: "2026-09-23T04:00:00.000Z" }, now: at("2026-09-23T04:00:00.500Z") });
  assert.equal(second.seq, 2);
  assert.deepEqual(await currentLock(db, ORG, b.id), second);
  assert.deepEqual((await listQuotes(db, ORG, b.id)).map((q) => [q.seq, q.purpose, q.rate]), [[1, "lock", "1616.24000"], [2, "lock", "1600.5"]]);
  // Another batch's history is separate.
  const other = await draft("rt2");
  assert.equal((await recordQuote(db, { orgId: ORG, batchId: other.id, purpose: "lock", quote: Q })).seq, 1);
});

test("once a submission froze the batch, a lock is refused (nothing stored); an execution quote still records", async () => {
  const b = await draft("fz");
  await recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: Q });
  await freeze(b);
  await assert.rejects(recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: Q }), (e: unknown) => e instanceof RateRecordError && e.code === "batch_frozen");
  assert.equal(count(b.id), 1);
  const exec = await recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "execution", quote: { ...Q, bid: "1650", ask: "1651", rate: "1650" } });
  assert.deepEqual([exec.seq, exec.purpose, exec.rate], [2, "execution", "1650"]);
  assert.equal((await currentLock(db, ORG, b.id))!.seq, 1, "the lock is still the one taken before submission");
});

test("invalid quotes and unknown batches never reach the database", async () => {
  const b = await draft("inv");
  const bad: [Partial<RateQuote>, RegExp][] = [
    [{ bid: "1617", rate: "1617", ask: "1616.97" }, /bid is above ask/],
    [{ bid: "1e3", rate: "1e3" }, /bid is not a positive decimal/],
    [{ ask: "-1" }, /ask is not a positive decimal/],
    [{ last: "0" }, /last is not a positive decimal/],
    [{ rate: "1616.97000" }, /rate must be the bid/],
    [{ rate: "1616.24" }, /rate must be the bid/], // equal in value, but the record says which string was used
    [{ fetchedAt: "2026-09-23T03:40:00Z" }, /fetchedAt must be ISO/],
  ];
  for (const [patch, re] of bad) {
    await assert.rejects(recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: { ...Q, ...patch } }), (e: unknown) => e instanceof RateRecordError && e.code === "quote_invalid" && re.test(e.message), JSON.stringify(patch));
  }
  assert.equal(count(b.id), 0);
  await assert.rejects(recordQuote(db, { orgId: ORG, batchId: "01900000-0000-7000-8000-000000000000", purpose: "lock", quote: Q }), (e: unknown) => e instanceof RateRecordError && e.code === "batch_unknown");
});

test("raw SQL: no update, delete or replace; malformed values and unknown batches are refused by the schema", async () => {
  const b = await draft("sql");
  await recordQuote(db, { orgId: ORG, batchId: b.id, purpose: "lock", quote: Q });
  const c = db.$client;
  assert.throws(() => c.prepare("UPDATE rate_quotes SET rate = '1', bid = '1' WHERE batch_id = ?").run(b.id), /never change/);
  assert.throws(() => c.prepare("DELETE FROM rate_quotes WHERE batch_id = ?").run(b.id), /never deleted/);
  const ins = (over: Record<string, unknown>, verb = "INSERT") => {
    const v = { org_id: ORG, batch_id: b.id, seq: 9, purpose: "lock", source: "kraken", pair: "XZECZUSD", bid: "1.5", ask: "2", last: "1.7", rate: "1.5", fetched_at: "2026-09-23T03:40:00.123Z", recorded_at: "2026-09-23T03:40:00.124Z", ...over };
    c.prepare(`${verb} INTO rate_quotes (org_id, batch_id, seq, purpose, source, pair, bid, ask, last, rate, fetched_at, recorded_at) VALUES (@org_id, @batch_id, @seq, @purpose, @source, @pair, @bid, @ask, @last, @rate, @fetched_at, @recorded_at)`).run(v);
  };
  assert.throws(() => ins({ seq: 1 }, "INSERT OR REPLACE"), /never replaced/);
  assert.throws(() => ins({ seq: 1 }, "INSERT OR IGNORE"), /never replaced/);
  for (const bid of ["1e3", "-5", ".5", "5.", "1.2.3", "1,5", " 1", "", "0x10"]) assert.throws(() => ins({ bid, rate: bid }), /CHECK constraint failed: rate_quotes_bid|greater than zero/, bid); // the shape CHECK, or the positivity trigger first (it runs before CHECKs)
  assert.throws(() => ins({ rate: "2" }), /rate_quotes_rate_is_bid/);
  // Positive prices only (review G1b round 1): zero in any of the three, however written, is refused.
  for (const zero of ["0", "0.0", "000.000"]) {
    assert.throws(() => ins({ bid: zero, rate: zero }), /greater than zero/, `bid ${zero}`);
    assert.throws(() => ins({ ask: zero }), /greater than zero/, `ask ${zero}`);
    assert.throws(() => ins({ last: zero }), /greater than zero/, `last ${zero}`);
  }
  ins({ seq: 8, bid: "0.00000001", rate: "0.00000001", ask: "0.1" }); // tiny but positive: accepted
  // bid above ask is NOT a schema rule (it needs decimal arithmetic); the application refuses it (above).
  ins({ seq: 7, bid: "3", rate: "3", ask: "2" });
  assert.throws(() => ins({ purpose: "fmv" }), /rate_quotes_purpose/);
  assert.throws(() => ins({ source: "coingecko" }), /rate_quotes_source/);
  assert.throws(() => ins({ fetched_at: "2026-09-23 03:40:00" }), /rate_quotes_fetched_at/);
  assert.throws(() => ins({ seq: 0 }), /rate_quotes_seq/);
  assert.throws(() => ins({ batch_id: "01900000-0000-7000-8000-000000000001" }), /FOREIGN KEY/);
  ins({ seq: 9 }); // well-formed: accepted
  assert.deepEqual(c.prepare("SELECT seq, rate FROM rate_quotes WHERE batch_id = ? ORDER BY seq").all(b.id), [{ seq: 1, rate: "1616.24000" }, { seq: 7, rate: "3" }, { seq: 8, rate: "0.00000001" }, { seq: 9, rate: "1.5" }]);
  await freeze(b);
  assert.throws(() => ins({ seq: 10 }), /batch is frozen/, "a raw lock insert after the freeze is refused too");
  ins({ seq: 10, purpose: "execution" });
});

test("concurrent writers on separate connections get distinct, consecutive seqs", async () => {
  const b = await draft("race");
  const WORKERS = 4;
  const EACH = 10;
  const workers = [...Array(WORKERS)].map(() => new Worker(new URL("./helpers/quote-worker.ts", import.meta.url), { workerData: { path } }));
  try {
    const gate = new SharedArrayBuffer(8);
    const g = new Int32Array(gate);
    const replies = workers.map((w) => new Promise<{ seqs: number[]; error?: string }>((resolve, reject) => { w.once("message", resolve); w.once("error", reject); }));
    for (const w of workers) w.postMessage({ orgId: ORG, batchId: b.id, count: EACH, gate });
    const deadline = Date.now() + 10_000;
    while (Atomics.load(g, 0) < WORKERS && Date.now() < deadline) Atomics.wait(g, 0, Atomics.load(g, 0), 50);
    Atomics.store(g, 1, 1);
    Atomics.notify(g, 1);
    const got = await Promise.all(replies);
    for (const r of got) assert.equal(r.error, undefined, r.error);
    const all = got.flatMap((r) => r.seqs).sort((x, y) => x - y);
    assert.deepEqual(all, [...Array(WORKERS * EACH)].map((_, i) => i + 1), "every seq once, no gaps");
    assert.equal(count(b.id), WORKERS * EACH);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
});
