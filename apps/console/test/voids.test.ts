// Voiding a draft (slice H5c): allowed while nothing may have been sent (no submission, or only failed_retryable);
// final and kept; its memos and payables are released for a new batch; and the schema holds every rule whatever
// writes the database, including on a database migrated from before the memo claims existed.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  batchDigest, batchNonce, createBatch, createBatchFromPayables, createPayable, createRecipient, defaultMigrationsDir, getBatch, migrateDb, openDb,
  SqliteIdempotencyStore, toExecutionBatch, voidBatch, VoidError, type BatchRecord, type ConsoleDb,
} from "../lib/index.ts";
import { payableHolders } from "../lib/data/payable-status.ts";

const ORG = "org-h5c";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const quote = (bid: string) => ({ source: "kraken" as const, pair: "XZECZUSD" as const, bid, ask: bid, last: bid, rate: bid, fetchedAt: "2026-09-25T08:00:00.000Z" });

let dir: string;
let db: ConsoleDb;
let alice: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h5c-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
  alice = (await createRecipient(db, { orgId: ORG, network: "regtest", displayName: "Alice", address: UA })).id;
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const hand = (memo = `V-${++n}`) => createBatch(db, { orgId: ORG, network: "regtest", title: `hand ${memo}`, items: [{ payableId: `h-${memo}`, address: UA, zat: 5n, memo }] });
/** A submission for the batch in `state` (as the execution library records one). */
async function attempt(rec: BatchRecord, state: "submitting" | "broadcast" | "failed_retryable" | "unknown_outcome") {
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "t", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  if (state !== "submitting") await store.update({ ...base, state, ...(state === "broadcast" ? { txid: "ab".repeat(32) } : {}), ...(state === "failed_retryable" ? { error: "refused before building" } : {}) }, { attempts: 1, states: ["submitting"] });
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof VoidError ? e.code : String(e)));

test("a draft is voided, final and kept: voidedAt set, the lines still readable; its memo is free again", async () => {
  const b = await hand("FREE-AGAIN");
  const v = await voidBatch(db, ORG, b.id, { now: () => new Date("2026-09-25T09:00:00.000Z") });
  assert.equal(v.voidedAt, "2026-09-25T09:00:00.000Z");
  assert.deepEqual(v.items, b.items, "kept, with its lines");
  assert.deepEqual(await getBatch(db, ORG, b.id), v);
  assert.ok(await hand("FREE-AGAIN"), "a voided batch holds no memo");
  assert.equal(await code(voidBatch(db, ORG, b.id)), "batch_voided", "final");
  assert.equal(await code(voidBatch(db, ORG, "01900000-0000-7000-8000-000000000000")), "batch_not_found");
  assert.equal(await code(voidBatch(db, "org-other", b.id)), "batch_not_found", "scoped to the org");
});

test("BTCPay's rule in our states: void after a refusal that sent nothing; never while an attempt may have sent", async () => {
  const refused = await hand();
  await attempt(refused, "failed_retryable");
  assert.equal(await code(voidBatch(db, ORG, refused.id)), "ok");
  for (const state of ["submitting", "broadcast", "unknown_outcome"] as const) {
    const b = await hand();
    await attempt(b, state);
    assert.equal(await code(voidBatch(db, ORG, b.id)), "batch_frozen", state);
    assert.equal((await getBatch(db, ORG, b.id))!.voidedAt, undefined, `${state}: nothing changed`);
  }
});

test("the payables of a voided batch from payables go into a new batch at another rate; the page status follows", async () => {
  const p = await createPayable(db, { orgId: ORG, recipientId: alice, kind: "invoice", usdCents: 160_000, reference: "RERATE-1" });
  const first = await createBatchFromPayables(db, { orgId: ORG, network: "regtest", title: "at 1600", payableIds: [p.id], quote: quote("1600.00") });
  assert.equal((await payableHolders(db, ORG)).get(p.id)?.batchId, first.batch.id);
  await attempt(first.batch, "failed_retryable"); // the guard refused it: the rate moved
  await voidBatch(db, ORG, first.batch.id);
  assert.equal((await payableHolders(db, ORG)).has(p.id), false, "free again");
  const second = await createBatchFromPayables(db, { orgId: ORG, network: "regtest", title: "at 1700", payableIds: [p.id], quote: quote("1700.00") });
  assert.deepEqual([second.lock.rate, second.batch.items[0].zat], ["1700.00", 94_117_647n], "$1,600.00 at 1700: 0.94117647 ZEC");
  assert.equal((await payableHolders(db, ORG)).get(p.id)?.batchId, second.batch.id);
});

test("the schema: a voided batch takes no attempt, retry, quote, receipt or change; a void is final; a live claim cannot be released", async () => {
  const b = await hand();
  await attempt(b, "failed_retryable");
  await voidBatch(db, ORG, b.id);
  const sql = (s: string, ...args: unknown[]) => () => db.$client.prepare(s).run(...args);
  const voided = /batch is voided: final/;
  assert.throws(sql("UPDATE submissions SET state = 'submitting' WHERE org_id = ? AND batch_id = ?", ORG, b.id), voided, "no retry");
  assert.throws(sql("INSERT INTO submissions (org_id, nonce, batch_id, batch_digest, state, attempts, created_at) VALUES (?, 'x-new', ?, 'd', 'submitting', 1, 't')", ORG, b.id), voided, "no new attempt");
  assert.throws(sql("INSERT INTO rate_quotes (org_id, batch_id, seq, purpose, source, pair, bid, ask, last, rate, fetched_at, recorded_at) VALUES (?, ?, 1, 'lock', 'kraken', 'XZECZUSD', '1', '1', '1', '1', '2026-09-25T08:00:00.000Z', '2026-09-25T08:00:00.000Z')", ORG, b.id), voided, "no quote");
  assert.throws(sql("INSERT INTO receipts (org_id, txid, pool, output_index, batch_id, idx) VALUES (?, 'ab', 'orchard', 0, ?, 0)", ORG, b.id), voided, "no receipt");
  assert.throws(sql("INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES (?, ?, 5, 'x', '', ?, 5, 'LATE')", ORG, b.id, UA), voided, "no new line");
  assert.throws(sql("UPDATE batches SET title = 'x' WHERE org_id = ? AND id = ?", ORG, b.id), /batch is (voided: final|frozen)/, "the batch does not change");
  assert.throws(sql("DELETE FROM batch_voids WHERE org_id = ? AND batch_id = ?", ORG, b.id), voided, "a void is final");
  assert.throws(sql("UPDATE batch_voids SET voided_at = '2026-09-25T10:00:00.000Z' WHERE org_id = ? AND batch_id = ?", ORG, b.id), voided);
  const live = await hand("LIVE-CLAIM");
  assert.throws(sql("DELETE FROM memo_claims WHERE org_id = ? AND batch_id = ?", ORG, live.id), /released only when its batch is voided/);
  assert.throws(sql("INSERT INTO batch_voids (org_id, batch_id, voided_at) VALUES (?, ?, '2026-09-25T10:00:00.000Z')", ORG, (await (async () => { const x = await hand(); await attempt(x, "broadcast"); return x; })()).id), /a submission may have paid/, "the backstop to the route's check");
});

test("migrating a database that has lines from before the claims: every memo is claimed, so a duplicate is still refused", async () => {
  const oldDir = join(dir, "migrations-0018");
  cpSync(defaultMigrationsDir(), oldDir, { recursive: true });
  rmSync(join(oldDir, "0019_void_and_claims.sql"));
  rmSync(join(oldDir, "meta", "0019_snapshot.json"));
  const journal = JSON.parse(readFileSync(join(oldDir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag !== "0019_void_and_claims");
  writeFileSync(join(oldDir, "meta", "_journal.json"), JSON.stringify(journal));
  const old = openDb({ path: join(dir, "old.db") });
  try {
    migrateDb(old, oldDir);
    old.$client.exec(`INSERT INTO batches (org_id, id, network, title, created_at, updated_at) VALUES ('o', '01900000-0000-7000-8000-000000000001', 'regtest', 'old', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
      INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES ('o', '01900000-0000-7000-8000-000000000001', 0, 'p', '', '${UA}', 5, 'OLD-MEMO');
      INSERT INTO batches (org_id, id, network, title, created_at, updated_at) VALUES ('o', '01900000-0000-7000-8000-000000000002', 'regtest', 'new', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');`);
    migrateDb(old);
    assert.deepEqual(old.$client.prepare("SELECT memo, batch_id FROM memo_claims").all(), [{ memo: "OLD-MEMO", batch_id: "01900000-0000-7000-8000-000000000001" }]);
    assert.throws(() => old.$client.prepare(`INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES ('o', '01900000-0000-7000-8000-000000000002', 0, 'q', '', '${UA}', 5, 'OLD-MEMO')`).run(), /UNIQUE constraint failed: memo_claims\.org_id, memo_claims\.memo/);
  } finally {
    old.$client.close();
  }
});
