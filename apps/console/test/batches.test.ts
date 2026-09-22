// Batch repository and schema (slice B1): UUIDv7 ids, exact round trip to the execution library's
// `Batch`, one validation rule set with preflight, constraints enforced by the schema itself, and the
// freeze triggers once a submission exists.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BatchInvalidError,
  batchDigest,
  batchNonce,
  createBatch,
  getBatch,
  listBatches,
  migrateDb,
  newBatchId,
  openDb,
  SqliteIdempotencyStore,
  toExecutionBatch,
  ZkoolBackend,
  ZkoolClient,
  type BatchItemInput,
  type ConsoleDb,
} from "../lib/index.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";

const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
const ORG = "org-b1";
const items = (tag: string): BatchItemInput[] => [
  { payableId: `${tag}-p1`, label: "Alice", address: R[0], zat: 101_000_000n, memo: `INV-${tag}-1` },
  { payableId: `${tag}-p2`, label: "Bob — 🦓", address: R[1], zat: 102_000_000n, memo: `INV-${tag}-2 é` },
  { payableId: `${tag}-p3`, address: R[2], zat: 1n, memo: `INV-${tag}-3` },
];

let dir: string;
let db: ConsoleDb;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-b1-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const count = (table: string) => (db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test("newBatchId: RFC 9562 UUIDv7 layout (the RFC's own test vector), version/variant bits, time order", () => {
  // RFC 9562 Appendix A.6: 017f22e2-79b0-7cc3-98c4-dc0c0c07398f (unix_ts_ms 0x017F22E279B0).
  const rfc = newBatchId(0x017f22e279b0, Uint8Array.from([0x0c, 0xc3, 0x18, 0xc4, 0xdc, 0x0c, 0x0c, 0x07, 0x39, 0x8f]));
  assert.equal(rfc, "017f22e2-79b0-7cc3-98c4-dc0c0c07398f");
  const ids = [1, 2, 3].map((k) => newBatchId(1_760_000_000_000 + k));
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual([...ids].sort(), ids, "later ids sort after earlier ones");
  assert.throws(() => newBatchId(-1), RangeError);
  assert.throws(() => newBatchId(2 ** 48), RangeError);
  assert.throws(() => newBatchId(0, new Uint8Array(9)), RangeError);
});

test("createBatch → getBatch → toExecutionBatch is exact: same items, bigint amounts, order, digest", async () => {
  const input = { orgId: ORG, network: "regtest" as const, title: "September payouts", items: items("rt") };
  const rec = await createBatch(db, input, { now: () => new Date("2026-09-23T10:00:00Z") });
  const loaded = await getBatch(db, ORG, rec.id);
  assert.deepEqual(loaded, rec);
  assert.equal(loaded!.items[2].label, "");
  const exec = toExecutionBatch(loaded!);
  assert.deepEqual(exec.items, input.items.map(({ payableId, address, zat, memo }) => ({ payableId, address, zat, memo })));
  assert.equal(batchDigest(exec), batchDigest({ id: rec.id, network: "regtest", items: input.items.map(({ payableId, address, zat, memo }) => ({ payableId, address, zat, memo })) }));
  assert.equal(batchNonce(rec), `batch/${rec.id}`);
  assert.equal(await getBatch(db, ORG, newBatchId()), undefined);
  assert.equal(await getBatch(db, "other-org", rec.id), undefined, "batches are scoped by org");
});

test("an invalid batch is refused with the same problem codes preflight reports, and nothing is written", async () => {
  const before = [count("batches"), count("batch_items")];
  const bad: BatchItemInput[] = [
    { payableId: "x", address: R[0].replace("uregtest1", "utest1"), zat: 0n, memo: "" },
    { payableId: "x", address: R[1], zat: 2_100_000_000_000_001n, memo: "m".repeat(513) },
    { payableId: "y", address: R[2], zat: 5n, memo: "dup" },
    { payableId: "z", address: R[2], zat: 5n, memo: "dup" },
  ];
  const err = await createBatch(db, { orgId: ORG, network: "regtest", title: "bad", items: bad }).catch((e: unknown) => e);
  assert.ok(err instanceof BatchInvalidError);
  const backend = new ZkoolBackend({ client: new ZkoolClient({ url: "http://127.0.0.1:1/graphql" }), account: 9, store: new SqliteIdempotencyStore(db, { orgId: ORG }) });
  const expected = backend.staticProblems({ id: "x", network: "regtest", items: bad.map(({ payableId, address, zat, memo }) => ({ payableId, address, zat, memo })) });
  assert.deepEqual(err.problems, expected);
  assert.deepEqual(err.problems.map((p) => p.code).sort(), ["address_hrp", "amount_nonpositive", "amount_too_large", "duplicate_payable", "memo_duplicate", "memo_empty", "memo_too_long"]);
  assert.deepEqual([count("batches"), count("batch_items")], before);
  await assert.rejects(createBatch(db, { orgId: ORG, network: "regtest", title: "empty", items: [] }), (e: unknown) => e instanceof BatchInvalidError && e.problems[0].code === "empty_batch");
});

test("listBatches: newest first, item counts, and exact totals beyond 2^53", async () => {
  const org = "org-list";
  const a = await createBatch(db, { orgId: org, network: "regtest", title: "A", items: items("la") }, { now: () => new Date("2026-09-23T11:00:00Z") });
  const big = [0, 1, 2, 3, 4].map((k) => ({ payableId: `big-${k}`, address: R[k % 3], zat: 2_100_000_000_000_000n, memo: `BIG-${k}` }));
  const b = await createBatch(db, { orgId: org, network: "regtest", title: "B", items: big }, { now: () => new Date("2026-09-23T12:00:00Z") });
  const list = await listBatches(db, org);
  assert.deepEqual(list.map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(list.map((x) => [x.itemCount, x.totalZat]), [[5, 10_500_000_000_000_000n], [3, 203_000_001n]]);
  assert.ok(10_500_000_000_000_000n > BigInt(Number.MAX_SAFE_INTEGER));
  assert.deepEqual(await listBatches(db, "nobody"), []);
});

test("the schema refuses impossible batches and items on its own", () => {
  const id = newBatchId();
  db.$client.prepare("INSERT INTO batches (org_id, id, network, title, created_at, updated_at) VALUES (?, ?, 'regtest', 't', 'x', 'x')").run(ORG, id);
  const item = db.$client.prepare("INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES (?, ?, ?, ?, '', ?, ?, ?)");
  item.run(ORG, id, 0, "p0", "uregtest1abc", 1, "M0");
  const code = (e: unknown) => (e as { code?: string }).code;
  const bad: [string, () => unknown, string][] = [
    ["zat 0", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 0, "M1"), "SQLITE_CONSTRAINT_CHECK"],
    ["zat above supply", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 2_100_000_000_000_001, "M1"), "SQLITE_CONSTRAINT_CHECK"],
    ["zat not an integer", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 1.5, "M1"), "SQLITE_CONSTRAINT_CHECK"],
    ["memo 513 bytes", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 1, "é".repeat(256) + "x"), "SQLITE_CONSTRAINT_CHECK"],
    ["memo empty", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 1, ""), "SQLITE_CONSTRAINT_CHECK"],
    ["uppercase address", () => item.run(ORG, id, 1, "p1", "UREGTEST1ABC", 1, "M1"), "SQLITE_CONSTRAINT_CHECK"],
    ["duplicate memo", () => item.run(ORG, id, 1, "p1", "uregtest1abc", 1, "M0"), "SQLITE_CONSTRAINT_UNIQUE"],
    ["duplicate payable", () => item.run(ORG, id, 1, "p0", "uregtest1abc", 1, "M1"), "SQLITE_CONSTRAINT_UNIQUE"],
    ["duplicate idx", () => item.run(ORG, id, 0, "p1", "uregtest1abc", 1, "M1"), "SQLITE_CONSTRAINT_PRIMARYKEY"],
    ["no such batch", () => item.run(ORG, newBatchId(), 0, "p1", "uregtest1abc", 1, "M1"), "SQLITE_CONSTRAINT_FOREIGNKEY"],
    ["bad network", () => db.$client.prepare("INSERT INTO batches VALUES (?, ?, 'mainnet', 't', 'x', 'x')").run(ORG, newBatchId()), "SQLITE_CONSTRAINT_CHECK"],
    ["id not a uuid", () => db.$client.prepare("INSERT INTO batches VALUES (?, 'batch-1', 'regtest', 't', 'x', 'x')").run(ORG), "SQLITE_CONSTRAINT_CHECK"],
    ["uppercase uuid", () => db.$client.prepare("INSERT INTO batches VALUES (?, ?, 'regtest', 't', 'x', 'x')").run(ORG, newBatchId().toUpperCase()), "SQLITE_CONSTRAINT_CHECK"],
    ["empty title", () => db.$client.prepare("INSERT INTO batches VALUES (?, ?, 'regtest', '', 'x', 'x')").run(ORG, newBatchId()), "SQLITE_CONSTRAINT_CHECK"],
  ];
  for (const [what, run, want] of bad) assert.throws(run, (e: unknown) => code(e) === want, what);
  // 512 bytes of memo is fine.
  item.run(ORG, id, 1, "p1", "uregtest1abc", 1, "é".repeat(256));
});

test("freeze: every change to a batch or its items is aborted once a submission exists", async () => {
  const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: "freeze me", items: items("fz") });
  const run = (sql: string, ...args: unknown[]) => () => db.$client.prepare(sql).run(...args);
  const ops: [string, () => unknown][] = [
    ["insert item", run("INSERT INTO batch_items VALUES (?, ?, 9, 'fz-p9', '', 'uregtest1abc', 1, 'INV-fz-9')", ORG, rec.id)],
    ["update item", run("UPDATE batch_items SET zat = zat + 1 WHERE org_id = ? AND batch_id = ? AND idx = 0", ORG, rec.id)],
    ["move item into the batch", run("UPDATE batch_items SET batch_id = ? WHERE org_id = ? AND batch_id = ? AND idx = 0", rec.id, ORG, "00000000-0000-7000-8000-000000000000")],
    ["delete item", run("DELETE FROM batch_items WHERE org_id = ? AND batch_id = ? AND idx = 2", ORG, rec.id)],
    ["update batch", run("UPDATE batches SET title = 'changed' WHERE org_id = ? AND id = ?", ORG, rec.id)],
    ["delete batch", run("DELETE FROM batches WHERE org_id = ? AND id = ?", ORG, rec.id)],
  ];
  // Before any submission, edits are possible at the database level (the repository offers none).
  db.$client.prepare("UPDATE batches SET title = 'renamed' WHERE org_id = ? AND id = ?").run(ORG, rec.id);
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  await store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: "t", attempts: 1 });
  for (const [what, op] of ops) {
    if (what === "move item into the batch") continue; // needs a second batch; covered below
    assert.throws(op, (e: unknown) => (e as { code?: string }).code === "SQLITE_CONSTRAINT_TRIGGER" && /frozen/.test((e as Error).message), what);
  }
  // Moving an item from an unfrozen batch into a frozen one is refused too (NEW side of the update trigger).
  const other = await createBatch(db, { orgId: ORG, network: "regtest", title: "other", items: items("ot") });
  assert.throws(run("UPDATE batch_items SET batch_id = ?, memo = 'INV-moved' WHERE org_id = ? AND batch_id = ? AND idx = 0", rec.id, ORG, other.id), (e: unknown) => (e as { code?: string }).code === "SQLITE_CONSTRAINT_TRIGGER");
  const still = await getBatch(db, ORG, rec.id);
  assert.equal(still?.title, "renamed");
  assert.deepEqual(still?.items, rec.items);
});

test("end to end: submit the loaded batch → one payment; a fresh load replays the same txid; the batch is frozen", async () => {
  const fake = await new FakeZkool().start();
  try {
    const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: "pay", items: items("e2e") });
    const client = new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 });
    const backend = new ZkoolBackend({ client, account: 9, store: new SqliteIdempotencyStore(db, { orgId: ORG }) });
    const first = await backend.submit(toExecutionBatch((await getBatch(db, ORG, rec.id))!), batchNonce(rec));
    const again = await backend.submit(toExecutionBatch((await getBatch(db, ORG, rec.id))!), batchNonce(rec));
    assert.deepEqual(again, { txid: first.txid, replayed: true, via: "record" });
    assert.equal(fake.payCalls, 1);
    assert.deepEqual(fake.mempool[0].recipients.map((r) => r.memo), rec.items.map((i) => i.memo));
    assert.throws(() => db.$client.prepare("UPDATE batch_items SET zat = 2 WHERE org_id = ? AND batch_id = ?").run(ORG, rec.id), /frozen/);
  } finally {
    await fake.stop();
  }
});

test("freeze hardening: REPLACE of a frozen batch is aborted even on a connection without recursive triggers", async () => {
  const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: "replace me", items: items("rp") });
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  await store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: "t", attempts: 1 });
  const replace = (conn: Database.Database) => () =>
    conn.prepare("INSERT OR REPLACE INTO batches (org_id, id, network, title, created_at, updated_at) VALUES (?, ?, 'main', 'hijacked', 'x', 'x')").run(ORG, rec.id);
  assert.equal(db.$client.pragma("recursive_triggers", { simple: true }), 1, "openDb enables recursive triggers");
  assert.throws(replace(db.$client), /frozen/);
  const raw = new Database(join(dir, "console.db")); // a plain connection: recursive_triggers OFF (SQLite default)
  try {
    assert.equal(raw.pragma("recursive_triggers", { simple: true }), 0);
    assert.throws(replace(raw), /frozen/, "the BEFORE INSERT trigger alone blocks REPLACE");
    assert.throws(() => raw.prepare("REPLACE INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES (?, ?, 0, 'rp-p1', '', 'uregtest1abc', 5, 'INV-rp-1')").run(ORG, rec.id), /frozen/);
  } finally {
    raw.close();
  }
  const still = await getBatch(db, ORG, rec.id);
  assert.deepEqual([still?.network, still?.title], ["regtest", "replace me"]);
});

test("freeze hardening: the submission (payment ledger) cannot be deleted or re-pointed, so it cannot unfreeze its batch", async () => {
  const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: "ledger", items: items("lg") });
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  const digest = batchDigest(toExecutionBatch(rec));
  await store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: digest, state: "submitting", createdAt: "t", attempts: 1 });
  const q = (sql: string, ...a: unknown[]) => () => db.$client.prepare(sql).run(...a);
  const key = [ORG, batchNonce(rec)];
  assert.throws(q("DELETE FROM submissions WHERE org_id = ? AND nonce = ?", ...key), /never deleted/);
  assert.throws(q("UPDATE submissions SET batch_id = 'elsewhere' WHERE org_id = ? AND nonce = ?", ...key), /never change/);
  assert.throws(q("UPDATE submissions SET org_id = 'other' WHERE org_id = ? AND nonce = ?", ...key), /never change/);
  assert.throws(q("UPDATE submissions SET nonce = 'n2' WHERE org_id = ? AND nonce = ?", ...key), /never change/);
  assert.throws(q("UPDATE submissions SET batch_digest = ? WHERE org_id = ? AND nonce = ?", "b".repeat(64), ...key), /never change/);
  // The store's own compare-and-set (which rewrites every column with the same identity) still works.
  assert.equal(await store.update({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: digest, state: "broadcast", txid: "c".repeat(64), createdAt: "t", attempts: 1 }, { attempts: 1, states: ["submitting"] }), true);
  assert.throws(q("DELETE FROM submission_txids WHERE org_id = ? AND txid = ?", ORG, "c".repeat(64)), /never deleted/);
  assert.throws(q("UPDATE batch_items SET zat = 777 WHERE org_id = ? AND batch_id = ?", ORG, rec.id), /frozen/);
  // On a plain connection (recursive triggers OFF, as the sqlite3 CLI or an admin tool), REPLACE on the ledger
  // or the index is a no-op: the existing row is kept, nothing is re-pointed, the batch stays frozen.
  const raw = new Database(join(dir, "console.db"));
  try {
    assert.equal(raw.pragma("recursive_triggers", { simple: true }), 0);
    const r1 = raw.prepare("INSERT OR REPLACE INTO submissions (org_id, nonce, batch_id, batch_digest, state, attempts, created_at, updated_at) VALUES (?, ?, 'elsewhere', ?, 'submitting', 1, 't', 't')").run(ORG, batchNonce(rec), "b".repeat(64));
    assert.equal(r1.changes, 0);
    const r2 = raw.prepare("INSERT OR REPLACE INTO submission_txids (org_id, txid, nonce, attempt) VALUES (?, ?, 'someone-else', 9)").run(ORG, "c".repeat(64));
    assert.equal(r2.changes, 0);
    // A plain UPDATE can neither move an index entry nor rename its txid (on either connection).
    for (const conn of [raw, db.$client]) {
      assert.throws(() => conn.prepare("UPDATE submission_txids SET nonce = 'someone-else', attempt = 7 WHERE org_id = ? AND txid = ?").run(ORG, "c".repeat(64)), /never changes/);
      assert.throws(() => conn.prepare("UPDATE submission_txids SET txid = ? WHERE org_id = ? AND txid = ?").run("e".repeat(64), ORG, "c".repeat(64)), /never changes/);
    }
  } finally {
    raw.close();
  }
  const kept = await store.get(batchNonce(rec));
  assert.deepEqual([kept?.batchId, kept?.batchDigest, kept?.state, kept?.txid], [rec.id, digest, "broadcast", "c".repeat(64)]);
  assert.equal((await store.findByTxid("c".repeat(64)))?.record.nonce, batchNonce(rec));
  assert.throws(q("UPDATE batch_items SET zat = 777 WHERE org_id = ? AND batch_id = ?", ORG, rec.id), /frozen/);
  // createIntent's ON CONFLICT DO NOTHING still reports "exists" (the IGNORE trigger keeps that path working).
  assert.equal((await store.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: digest, state: "submitting", createdAt: "t", attempts: 1 })).created, false);
});

test("the freeze needs the store's org and the backend's batch id to match the batch (documented precondition)", async () => {
  const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: "wrong org", items: items("wo") });
  const wrong = new SqliteIdempotencyStore(db, { orgId: "some-other-org" });
  await wrong.createIntent({ nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), state: "submitting", createdAt: "t", attempts: 1 });
  // A submission recorded under another org does not freeze this org's batch: the pairing is the caller's job.
  db.$client.prepare("UPDATE batches SET title = 'still editable' WHERE org_id = ? AND id = ?").run(ORG, rec.id);
  assert.equal((await getBatch(db, ORG, rec.id))?.title, "still editable");
});

test("createBatch refuses text that cannot round-trip (lone surrogates) and console fields out of bounds, writing nothing", async () => {
  const before = [count("batches"), count("batch_items")];
  const ok = items("tx");
  const cases: [string, Parameters<typeof createBatch>[1], string[]][] = [
    ["surrogate memo", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], memo: "INV-\ud800-1" }] }, ["memo_malformed"]],
    ["surrogate payable", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], payableId: "p-\udc00" }] }, ["payable_malformed"]],
    ["empty title", { orgId: ORG, network: "regtest", title: "", items: ok }, ["title_invalid"]],
    ["long title", { orgId: ORG, network: "regtest", title: "t".repeat(201), items: ok }, ["title_invalid"]],
    ["surrogate title", { orgId: ORG, network: "regtest", title: "t\ud800", items: ok }, ["title_invalid"]],
    ["empty payable id", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], payableId: "" }] }, ["payable_id_invalid"]],
    ["long payable id", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], payableId: "p".repeat(201) }] }, ["payable_id_invalid"]],
    ["long label", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], label: "l".repeat(201) }] }, ["label_invalid"]],
    ["surrogate label", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], label: "\udfff" }] }, ["label_invalid"]],
    ["NUL-led title", { orgId: ORG, network: "regtest", title: "\u0000x", items: ok }, ["title_invalid"]],
    ["NUL-led payable id", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], payableId: "\u0000p" }] }, ["payable_id_invalid"]],
    ["control char in label", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], label: "a\u0007b" }] }, ["label_invalid"]],
    ["NUL in memo", { orgId: ORG, network: "regtest", title: "t", items: [{ ...ok[0], memo: "INV-1\u0000" }] }, ["memo_malformed"]],
    ["201 emoji title", { orgId: ORG, network: "regtest", title: "🦓".repeat(201), items: ok }, ["title_invalid"]],
  ];
  for (const [what, input, codes] of cases) {
    const e = await createBatch(db, input).catch((x: unknown) => x);
    assert.ok(e instanceof BatchInvalidError, what);
    assert.deepEqual(e.problems.map((p) => p.code), codes, what);
  }
  await assert.rejects(createBatch(db, { orgId: "", network: "regtest", title: "t", items: ok }), RangeError);
  // The same well-formedness rules hold at preflight (one shared rule set).
  const backend = new ZkoolBackend({ client: new ZkoolClient({ url: "http://127.0.0.1:1/graphql" }), account: 9, store: new SqliteIdempotencyStore(db, { orgId: ORG }) });
  assert.deepEqual(backend.staticProblems({ id: "x", network: "regtest", items: [{ payableId: "p\ud800", address: R[0], zat: 1n, memo: "M\udc00" }] }).map((p) => p.code), ["memo_malformed", "payable_malformed"]);
  assert.deepEqual([count("batches"), count("batch_items")], before);
  // Title and label at exactly 200 characters (code points, as the schema counts) are fine, emoji included.
  await createBatch(db, { orgId: ORG, network: "regtest", title: "t".repeat(200), items: [{ ...items("edge")[0], label: "l".repeat(200), payableId: "p".repeat(200) }] });
  const emoji = await createBatch(db, { orgId: ORG, network: "regtest", title: "🦓".repeat(200), items: [{ ...items("emoji")[0], label: "🦓".repeat(200) }] });
  assert.equal((await getBatch(db, ORG, emoji.id))?.title, "🦓".repeat(200));
});

test("listBatches orders by creation time, not by id, so caller-supplied ids keep the order", async () => {
  const org = "org-order";
  const ids = ["ffffffff-ffff-7fff-bfff-ffffffffffff", "00000000-0000-7000-8000-000000000000"];
  const first = await createBatch(db, { orgId: org, network: "regtest", title: "first", items: items("o1") }, { now: () => new Date("2026-09-23T08:00:00Z"), newId: () => ids[0] });
  const second = await createBatch(db, { orgId: org, network: "regtest", title: "second", items: items("o2") }, { now: () => new Date("2026-09-23T09:00:00Z"), newId: () => ids[1] });
  assert.deepEqual((await listBatches(db, org)).map((b) => b.id), [second.id, first.id]);
});
