// SQLite-specific properties of the nonce store: migrations, constraints the schema enforces on its own,
// org scoping, busy-lock mapping and durability after a busy failure (the libSQL defect that ruled that
// driver out), and the backend running on it. The behavioural contract shared with the memory and file
// stores is in store-contract.test.ts.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMigrationsDir, migrateDb, NonceConflictError, openDb, SqliteIdempotencyStore, StoreBusyError, ZkoolBackend, ZkoolClient, type Batch, type ConsoleDb } from "../lib/index.ts";
import { base } from "./helpers/store-contract.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";

let dir: string;
const dbs: ConsoleDb[] = [];
function fresh(name: string, busyTimeoutMs?: number): { db: ConsoleDb; path: string } {
  const path = join(dir, `${name}.db`);
  const db = openDb({ path, busyTimeoutMs });
  dbs.push(db);
  migrateDb(db);
  return { db, path };
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-sqlite-"));
});
after(async () => {
  for (const db of dbs) if (db.$client.open) db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

test("openDb refuses in-memory and URL-style locations, and sets WAL, FULL sync and foreign keys", () => {
  assert.throws(() => openDb({ path: ":memory:" }), RangeError);
  assert.throws(() => openDb({ path: "file:x.db" }), RangeError);
  assert.throws(() => openDb({ path: "" }), RangeError);
  const { db } = fresh("pragmas");
  assert.equal(db.$client.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(db.$client.pragma("synchronous", { simple: true }), 2); // FULL
  assert.equal(db.$client.pragma("foreign_keys", { simple: true }), 1);
});

test("migrations apply once (one journal row per committed migration); a second run is a no-op", () => {
  const { db } = fresh("migrate");
  migrateDb(db);
  const journal = JSON.parse(readFileSync(join(defaultMigrationsDir(), "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  assert.equal((db.$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, journal.entries.length);
  const names = (type: string) =>
    (db.$client.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all(type) as { name: string }[]).map((r) => r.name);
  assert.deepEqual(names("table"), ["batch_items", "batches", "rate_quotes", "receipts", "submission_claims", "submission_txids", "submissions"]);
  assert.deepEqual(names("trigger"), [
    "batch_items_frozen_delete",
    "batch_items_frozen_insert",
    "batch_items_frozen_update",
    "batches_frozen_delete",
    "batches_frozen_insert",
    "batches_frozen_update",
    "rate_quotes_lock_frozen",
    "rate_quotes_no_delete",
    "rate_quotes_no_replace",
    "rate_quotes_no_update",
    "receipts_fixed",
    "receipts_keep",
    "receipts_no_delete",
    "receipts_own_broadcast",
    "receipts_sealed_valid_insert",
    "receipts_sealed_valid_update",
    "submission_txids_fixed",
    "submission_txids_keep",
    "submission_txids_no_delete",
    "submissions_identity_fixed",
    "submissions_keep",
    "submissions_no_delete",
  ]);
});

test("the schema rejects impossible records on its own (CHECK, NOT NULL, foreign keys)", () => {
  const { db } = fresh("checks");
  const ins = db.$client.prepare("INSERT INTO submissions (org_id, nonce, batch_id, batch_digest, state, attempts, txid, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run("org", "n1", "b", "a".repeat(64), "submitting", 1, null, "t", "t");
  const bad: [string, unknown[]][] = [
    ["state", ["org", "n2", "b", "a".repeat(64), "paid", 1, null, "t", "t"]],
    ["attempts", ["org", "n3", "b", "a".repeat(64), "submitting", 0, null, "t", "t"]],
    ["digest", ["org", "n4", "b", "xyz", "submitting", 1, null, "t", "t"]],
    ["txid", ["org", "n5", "b", "a".repeat(64), "submitting", 1, "Z".repeat(64), "t", "t"]],
    ["broadcast without txid", ["org", "n6", "b", "a".repeat(64), "broadcast", 1, null, "t", "t"]],
    ["empty nonce", ["org", "", "b", "a".repeat(64), "submitting", 1, null, "t", "t"]],
    ["null org", [null, "n7", "b", "a".repeat(64), "submitting", 1, null, "t", "t"]],
  ];
  const constraint = (kind: string) => (e: unknown) => (e as { code?: string }).code === `SQLITE_CONSTRAINT_${kind}`;
  const kinds: Record<string, string> = { "null org": "NOTNULL" };
  for (const [what, v] of bad) assert.throws(() => ins.run(...v), constraint(kinds[what] ?? "CHECK"), what);
  assert.throws(() => db.$client.prepare("INSERT INTO submission_claims VALUES ('org', 'no-such-nonce', 2, 0, 1)").run(), constraint("FOREIGNKEY"));
  assert.throws(() => db.$client.prepare("INSERT INTO submission_claims VALUES ('org', 'n1', 1, 0, 1)").run(), constraint("CHECK"), "attempt 1 is never claimed");
  assert.throws(() => db.$client.prepare("INSERT INTO submission_txids (org_id, txid, nonce, attempt) VALUES ('org', ?, 'no-such-nonce', 1)").run("a".repeat(64)), constraint("FOREIGNKEY"));
});

test("records are scoped by org: the same nonce in two orgs is two independent records", async () => {
  const { db } = fresh("orgs");
  const a = new SqliteIdempotencyStore(db, { orgId: "org-a" });
  const b = new SqliteIdempotencyStore(db, { orgId: "org-b" });
  assert.equal((await a.createIntent(base("same"))).created, true);
  assert.equal((await b.createIntent(base("same", { batchId: "other" }))).created, true);
  assert.equal(await a.update({ ...base("same"), state: "broadcast", txid: "1".repeat(64) }, { attempts: 1, states: ["submitting"] }), true);
  assert.equal((await b.get("same"))?.state, "submitting");
  assert.equal(await b.findByTxid("1".repeat(64)), undefined);
  assert.equal((await a.findByTxid("1".repeat(64)))?.record.batchId, "batch-same");
  // Both orgs record the same txid (a misconfiguration, e.g. one Zkool account shared by two orgs): each
  // org keeps its own index entry; neither can take over the other's.
  assert.equal(await b.update({ ...base("same", { batchId: "other" }), state: "broadcast", txid: "1".repeat(64) }, { attempts: 1, states: ["submitting"] }), true);
  assert.equal((await a.findByTxid("1".repeat(64)))?.record.batchId, "batch-same");
  assert.equal((await b.findByTxid("1".repeat(64)))?.record.batchId, "other");
  assert.throws(() => new SqliteIdempotencyStore(db, { orgId: "" }), RangeError);
});

test("a write blocked by another process's lock ends in StoreBusyError after the busy timeout, and every later write is durable", async () => {
  const { db, path } = fresh("busy", 150);
  const store = new SqliteIdempotencyStore(db, { orgId: "org" });
  await store.createIntent(base("n-busy"));
  const holder = new Database(path);
  holder.exec("BEGIN IMMEDIATE"); // another process holding the write lock
  const t0 = Date.now();
  await assert.rejects(store.update({ ...base("n-busy"), attempts: 2 }, { attempts: 1, states: ["submitting"] }), StoreBusyError);
  await assert.rejects(store.claimAttempt("n-busy", 2, 1_000), StoreBusyError);
  await assert.rejects(store.createIntent(base("n-busy-2")), StoreBusyError);
  assert.ok(Date.now() - t0 >= 400, "waited for the busy timeout each time");
  holder.exec("ROLLBACK");
  holder.close();
  // The libSQL defect (root cause of tursodatabase/libsql-client-ts#352; our reproduction): after a busy
  // failure, later writes reported success but never committed. Every write must be visible to an
  // independent connection (same library, so the lock is real).
  assert.equal(await store.update({ ...base("n-busy"), attempts: 2 }, { attempts: 1, states: ["submitting"] }), true);
  assert.equal((await store.createIntent(base("n-busy-2"))).created, true);
  assert.equal(await store.claimAttempt("n-busy", 3, 1_000), true);
  const other = new Database(path, { readonly: true });
  try {
    assert.equal((other.prepare("SELECT attempts FROM submissions WHERE nonce = 'n-busy'").get() as { attempts: number }).attempts, 2);
    assert.equal((other.prepare("SELECT count(*) AS n FROM submissions").get() as { n: number }).n, 2);
    assert.equal((other.prepare("SELECT count(*) AS n FROM submission_claims").get() as { n: number }).n, 1);
  } finally {
    other.close();
  }
});

test("ZkoolBackend on SQLite: idempotent replay, nonce conflict, and a restart with a fresh connection", async () => {
  const fake = await new FakeZkool().start();
  try {
    const { db, path } = fresh("backend");
    const R = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const batch: Batch = { id: "b-sql", network: "regtest", items: [{ payableId: "p1", address: R, zat: 1_000_000n, memo: "INV-SQL-1" }] };
    const client = new ZkoolClient({ url: fake.url, timeoutMs: 2_000, payTimeoutMs: 2_000 });
    const backend = new ZkoolBackend({ client, account: 9, store: new SqliteIdempotencyStore(db, { orgId: "org" }) });
    const first = await backend.submit(batch, "nonce-sql");
    assert.deepEqual(await backend.submit(batch, "nonce-sql"), { txid: first.txid, replayed: true, via: "record" });
    await assert.rejects(backend.submit({ ...batch, items: [{ ...batch.items[0], zat: 2n }] }, "nonce-sql"), NonceConflictError);
    db.$client.close(); // "restart"
    const reopened = openDb({ path });
    dbs.push(reopened);
    const again = new ZkoolBackend({ client, account: 9, store: new SqliteIdempotencyStore(reopened, { orgId: "org" }) });
    assert.deepEqual(await again.submit(batch, "nonce-sql"), { txid: first.txid, replayed: true, via: "record" });
    assert.equal(fake.payCalls, 1);
    fake.mine();
    assert.equal((await again.status(first.txid)).state, "mined");
  } finally {
    await fake.stop();
  }
});
