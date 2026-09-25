// The audit trail, the data layer (slice I4; design I4.4.1): each trigger of migration 0021 writes its event with the
// row's own time and a non-secret detail, in the same transaction as the change (a rolled-back change leaves none); a
// compare-and-set that changes nothing is not an event; the log is append-only; the migration backfills a database
// that existed before it.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendId,
  batchDigest,
  batchNonce,
  createBatch,
  currentLock,
  defaultMigrationsDir,
  Keyring,
  listAudit,
  migrateDb,
  openDb,
  recordApproval,
  recordQuote,
  SqliteIdempotencyStore,
  toExecutionBatch,
  voidBatch,
  type BatchRecord,
  type ConsoleDb,
} from "../lib/index.ts";

const ORG = "org-i4";
const RING = new Keyring([{ kid: "k1", key: Buffer.alloc(32, 9) }]);
const QUOTE = (bid: string) => ({ source: "kraken" as const, pair: "XZECZUSD" as const, bid, ask: bid, last: bid, rate: bid, fetchedAt: "2026-09-25T10:00:00.000Z", host: "api.kraken.com" });
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";

let dir: string;
let db: ConsoleDb;
let n = 0;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-i4-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const draft = async (d: ConsoleDb = db): Promise<BatchRecord> => {
  n++;
  return createBatch(d, { orgId: ORG, network: "regtest", title: `audit ${n}`, items: [{ payableId: `a${n}`, address: UA, zat: 1000n, memo: `AUDIT-${n}` }] }, { now: () => new Date("2026-09-25T09:00:00.000Z") });
};

test("created, locked, quoted, approved, voided: one event each, at the row's own time, with a non-secret detail", async () => {
  const rec = await draft();
  const lock = await recordQuote(db, { orgId: ORG, batchId: rec.id, purpose: "lock", quote: QUOTE("1600.00"), now: () => new Date("2026-09-25T09:01:00.000Z") });
  await recordQuote(db, { orgId: ORG, batchId: rec.id, purpose: "execution", quote: QUOTE("1601.00"), now: () => new Date("2026-09-25T09:02:00.000Z") });
  await recordApproval(db, RING, { rec, lock, backend: backendId(9), now: () => new Date("2026-09-25T09:03:00.000Z") });
  await voidBatch(db, ORG, rec.id, { now: () => new Date("2026-09-25T09:04:00.000Z") });
  const events = await listAudit(db, ORG, rec.id);
  assert.deepEqual(events.map((e) => [e.action, e.at, e.detail]), [
    ["created", "2026-09-25T09:00:00.000Z", { title: rec.title, network: "regtest" }],
    ["locked", "2026-09-25T09:01:00.000Z", { seq: 1, rate: "1600.00", source: "kraken" }],
    ["quoted", "2026-09-25T09:02:00.000Z", { seq: 2, rate: "1601.00", source: "kraken" }],
    ["approved", "2026-09-25T09:03:00.000Z", { seq: 1, lockSeq: 1, approver: "operator" }],
    ["voided", "2026-09-25T09:04:00.000Z", {}],
  ]);
  assert.ok(events.every((e, i) => i === 0 || e.id > events[i - 1].id), "ids increase in commit order");
  const hmac = db.$client.prepare("SELECT hmac FROM approvals WHERE batch_id = ?").pluck().get(rec.id) as string;
  const all = JSON.stringify(events);
  for (const secret of [hmac, UA, `AUDIT-${n}`]) assert.ok(!all.includes(secret), "no HMAC, address or memo in the trail");
});

test("each submission change is an event (every attempt kept, which the row alone forgets); a change of nothing is not", async () => {
  const rec = await draft();
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "2026-09-25T09:10:00.000Z", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  assert.equal(await store.update({ ...base, state: "failed_retryable", error: "Not enough funds" }, { attempts: 1, states: ["submitting"] }), true);
  assert.equal(await store.update({ ...base, attempts: 2, state: "submitting" }, { attempts: 1, states: ["failed_retryable"] }), true);
  assert.equal(await store.update({ ...base, attempts: 2, state: "broadcast", txid: "ab".repeat(32), broadcastAt: "2026-09-25T09:11:00.000Z" }, { attempts: 2, states: ["submitting"] }), true);
  assert.equal(await store.update({ ...base, attempts: 2, state: "broadcast", txid: "ab".repeat(32), broadcastAt: "2026-09-25T09:11:00.000Z", expiresBy: 740 }, { attempts: 2, states: ["broadcast"] }), true);
  const before = (await listAudit(db, ORG, rec.id)).length;
  // The same record written again (a compare-and-set that changes nothing the trail tracks) is not an event.
  db.$client.prepare("UPDATE submissions SET updated_at = updated_at WHERE batch_id = ?").run(rec.id);
  assert.equal((await listAudit(db, ORG, rec.id)).length, before);
  const events = (await listAudit(db, ORG, rec.id)).slice(1);
  assert.deepEqual(events.map((e) => [e.action, e.detail.attempts]), [
    ["attempt_submitting", 1],
    ["attempt_failed_retryable", 1],
    ["attempt_submitting", 2],
    ["attempt_broadcast", 2],
    ["expiry_recorded", 2],
  ]);
  assert.equal(events[1].detail.error, "Not enough funds", "the refusal's reason is kept, as the status route shows it");
  assert.equal(events[3].detail.txid, "ab".repeat(32));
  assert.equal(events[4].detail.expiresBy, 740);
});

test("in the same transaction: a rolled-back change leaves no event", async () => {
  const rec = await draft();
  const count = () => db.$client.prepare("SELECT count(*) FROM audit_log WHERE batch_id = ?").pluck().get(rec.id) as number;
  const before = count();
  assert.throws(() =>
    db.$client.transaction(() => {
      db.$client.prepare("INSERT INTO batch_voids (org_id, batch_id, voided_at) VALUES (?, ?, '2026-09-25T09:20:00.000Z')").run(ORG, rec.id);
      throw new Error("abort");
    })(),
  );
  assert.equal(count(), before);
  // A refused change (the trigger aborts the insert) leaves none either: a lock on a voided batch.
  await voidBatch(db, ORG, rec.id);
  const voided = count();
  await assert.rejects(recordQuote(db, { orgId: ORG, batchId: rec.id, purpose: "lock", quote: QUOTE("1600.00") }), { code: "batch_voided" });
  assert.equal(count(), voided);
});

test("append-only: no update, no delete", async () => {
  const rec = await draft();
  assert.throws(() => db.$client.prepare("UPDATE audit_log SET action = 'x' WHERE batch_id = ?").run(rec.id), /audit log is append-only/);
  assert.throws(() => db.$client.prepare("DELETE FROM audit_log WHERE batch_id = ?").run(rec.id), /audit log is append-only/);
  assert.throws(() => db.$client.prepare("INSERT INTO audit_log (org_id, batch_id, at, action, detail) VALUES (?, ?, 't', 'x', '[1]')").run(ORG, rec.id), /CHECK constraint failed/, "the detail is a JSON object");
});

test("the migration backfills a database from before it: every record becomes an event, marked backfilled, in order", async () => {
  // The migrations folder as it stood before 0021.
  const old = join(dir, "migrations-0020");
  cpSync(defaultMigrationsDir(), old, { recursive: true });
  const journal = JSON.parse(readFileSync(join(old, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  for (const e of journal.entries.filter((e) => e.idx >= 21)) {
    rmSync(join(old, `${e.tag}.sql`));
    rmSync(join(old, "meta", `${e.tag.slice(0, 4)}_snapshot.json`));
  }
  journal.entries = journal.entries.filter((e) => e.idx < 21);
  writeFileSync(join(old, "meta", "_journal.json"), JSON.stringify(journal));
  const legacy = openDb({ path: join(dir, "legacy.db") });
  try {
    migrateDb(legacy, old);
    const rec = await draft(legacy);
    // The quote as a database from before migration 0024 held it: no source_host column yet (slice N1).
    legacy.$client.prepare("INSERT INTO rate_quotes (org_id, batch_id, seq, purpose, source, pair, bid, ask, last, rate, fetched_at, recorded_at) VALUES (?, ?, 1, 'lock', 'kraken', 'XZECZUSD', '1600.00', '1600.00', '1600.00', '1600.00', '2026-09-25T10:00:00.000Z', '2026-09-25T09:01:00.000Z')").run(ORG, rec.id);
    // And its approval, likewise by SQL (the code of today reads columns that database lacks); the backfill copies rows,
    // it does not verify their HMACs.
    legacy.$client.prepare("INSERT INTO approvals (org_id, batch_id, seq, approver, approved_at, lock_seq, kid, hmac) VALUES (?, ?, 1, 'operator', '2026-09-25T09:02:00.000Z', 1, 'k1', ?)").run(ORG, rec.id, "ab".repeat(32));
    const store = new SqliteIdempotencyStore(legacy, { orgId: ORG });
    const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "2026-09-25T09:03:00.000Z", attempts: 1 };
    await store.createIntent({ ...base, state: "submitting" });
    await store.update({ ...base, state: "failed_retryable", error: "refused" }, { attempts: 1, states: ["submitting"] });
    migrateDb(legacy);
    const events = await listAudit(legacy, ORG, rec.id);
    assert.deepEqual(events.map((e) => [e.action, e.detail.backfilled]), [["created", true], ["locked", true], ["approved", true], ["attempt_failed_retryable", true]]);
    assert.equal(events[3].detail.error, "refused");
    assert.equal((await currentLock(legacy, ORG, rec.id))?.seq, 1);
    // From now on the triggers write: a new lock is an event, not backfilled.
    await recordQuote(legacy, { orgId: ORG, batchId: rec.id, purpose: "lock", quote: QUOTE("1600.00") });
    const last = (await listAudit(legacy, ORG, rec.id)).at(-1)!;
    assert.deepEqual([last.action, last.detail.backfilled], ["locked", undefined]);
  } finally {
    legacy.$client.close();
  }
});
