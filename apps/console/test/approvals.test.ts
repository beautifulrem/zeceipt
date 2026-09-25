// Approvals, the data layer (slice I3; design I3.4.1): an approval verifies over the batch as it is now at its current
// lock; a re-lock, any change to a line (by raw SQL: the app has no edit path), another backend or a dropped key id
// makes it stop verifying; a rotated keyring still verifies it; the table is append-only and refuses voided, frozen
// and lock-less approvals; the approval key is not the sealing key.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalMessage,
  backendId,
  createBatch,
  currentLock,
  getBatch,
  Keyring,
  migrateDb,
  openDb,
  recordApproval,
  recordQuote,
  validApproval,
  type BatchRecord,
  type ConsoleDb,
} from "../lib/index.ts";

const ORG = "org-i3";
const K1 = { kid: "k1", key: Buffer.alloc(32, 1) };
const K2 = { kid: "k2", key: Buffer.alloc(32, 2) };
const RING = new Keyring([K1]);
const BACKEND = backendId(9);
const QUOTE = (bid: string) => ({ source: "kraken" as const, pair: "XZECZUSD" as const, bid, ask: bid, last: bid, rate: bid, fetchedAt: "2026-09-25T10:00:00.000Z", host: "api.kraken.com" });
const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];

let dir: string;
let db: ConsoleDb;
let n = 0;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-i3-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

/** A two-line draft, locked at 1600.00. */
async function locked(): Promise<BatchRecord> {
  n++;
  const rec = await createBatch(db, { orgId: ORG, network: "regtest", title: `a${n}`, items: [
    { payableId: `p${n}-0`, address: R[0], zat: 1000n, memo: `A${n}-0` },
    { payableId: `p${n}-1`, address: R[1], zat: 2500n, memo: `A${n}-1` },
  ] });
  await recordQuote(db, { orgId: ORG, batchId: rec.id, purpose: "lock", quote: QUOTE("1600.00") });
  return rec;
}
const now = async (rec: BatchRecord) => (await getBatch(db, ORG, rec.id))!;
const valid = async (rec: BatchRecord, ring = RING, backend = BACKEND) => validApproval(db, ring, await now(rec), await currentLock(db, ORG, rec.id), backend);
const sql = (text: string, ...args: unknown[]) => db.$client.prepare(text).run(...args);

test("an approval verifies over the batch as it is now, at its lock, for its backend", async () => {
  const rec = await locked();
  assert.equal(await valid(rec), undefined, "not approved before approving");
  const a = await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND, now: () => new Date("2026-09-25T10:01:00Z") });
  assert.deepEqual(a, { seq: 1, approver: "operator", approvedAt: "2026-09-25T10:01:00.000Z", lockSeq: 1 });
  assert.deepEqual(await valid(rec), a);
  assert.equal(await valid(rec, RING, backendId(10)), undefined, "approving payment from one account does not approve it from another");
  const row = db.$client.prepare("SELECT kid, hmac FROM approvals WHERE batch_id = ?").get(rec.id) as { kid: string; hmac: string };
  assert.equal(row.kid, "k1");
  assert.match(row.hmac, /^[0-9a-f]{64}$/);
});

test("a re-lock invalidates the approval; approving at the new lock makes it valid again", async () => {
  const rec = await locked();
  await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  await recordQuote(db, { orgId: ORG, batchId: rec.id, purpose: "lock", quote: QUOTE("1600.00") });
  assert.equal(await valid(rec), undefined, "even at the same rate: the approval named lock 1");
  const again = await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  assert.deepEqual([again.seq, again.lockSeq], [2, 2]);
  assert.deepEqual(await valid(rec), again);
});

test("any change to a line before submission (raw SQL) invalidates the approval: zat, memo, address, payable id", async () => {
  for (const [column, value] of [["zat", 1001], ["memo", "CHANGED"], ["address", R[1]], ["payable_id", "other"]] as const) {
    const rec = await locked();
    await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
    assert.ok(await valid(rec), column);
    sql(`UPDATE batch_items SET ${column} = ? WHERE batch_id = ? AND idx = 0`, value, rec.id);
    assert.equal(await valid(rec), undefined, `${column} changed`);
  }
});

test("the label is display only: changing it keeps the approval; swapping two lines' order does not", async () => {
  const rec = await locked();
  await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  sql("UPDATE batch_items SET label = 'Alice' WHERE batch_id = ? AND idx = 0", rec.id);
  assert.ok(await valid(rec), "a label is not paid");
  const lock = (await currentLock(db, ORG, rec.id))!;
  const swapped = { ...rec, items: rec.items.map((i) => ({ ...i, idx: 1 - i.idx })) };
  assert.notEqual(approvalMessage(swapped, lock, BACKEND), approvalMessage(rec, lock, BACKEND), "the output order is part of the message");
});

test("key rotation: a k1 approval verifies with [k1, k2]; a keyring without k1 cannot verify it (approve again)", async () => {
  const rec = await locked();
  await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  const rotated = new Keyring([K1, K2]);
  assert.ok(await valid(rec, rotated), "the old key is still listed");
  assert.equal(await valid(rec, new Keyring([K2])), undefined, "k1 dropped: fail closed");
  const renewed = await recordApproval(db, rotated, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  assert.equal((db.$client.prepare("SELECT kid FROM approvals WHERE batch_id = ? AND seq = ?").get(rec.id, renewed.seq) as { kid: string }).kid, "k2", "the current key signs");
  assert.deepEqual(await valid(rec, new Keyring([K2])), renewed);
});

test("a forged row (another key's HMAC, or another batch's) does not verify", async () => {
  const a = await locked();
  const b = await locked();
  await recordApproval(db, RING, { rec: a, lock: (await currentLock(db, ORG, a.id))!, backend: BACKEND });
  const { hmac } = db.$client.prepare("SELECT hmac FROM approvals WHERE batch_id = ?").get(a.id) as { hmac: string };
  sql("INSERT INTO approvals (org_id, batch_id, seq, approver, approved_at, lock_seq, kid, hmac) VALUES (?, ?, 1, 'operator', '2026-09-25T10:00:00.000Z', 1, 'k1', ?)", ORG, b.id, hmac);
  assert.equal(await valid(b), undefined, "a's HMAC names a's id and lines");
  sql("INSERT INTO approvals (org_id, batch_id, seq, approver, approved_at, lock_seq, kid, hmac) VALUES (?, ?, 2, 'operator', '2026-09-25T10:00:00.000Z', 1, 'k1', ?)", ORG, b.id, "0".repeat(64));
  assert.equal(await valid(b), undefined);
});

test("the table: append-only, and no approval for a voided or frozen batch or a lock it does not have", async () => {
  const rec = await locked();
  await recordApproval(db, RING, { rec, lock: (await currentLock(db, ORG, rec.id))!, backend: BACKEND });
  assert.throws(() => sql("UPDATE approvals SET lock_seq = 2 WHERE batch_id = ?", rec.id), /approvals are append-only/);
  assert.throws(() => sql("DELETE FROM approvals WHERE batch_id = ?", rec.id), /approvals are append-only/);
  const ghost = { ...(await currentLock(db, ORG, rec.id))!, seq: 7 };
  await assert.rejects(recordApproval(db, RING, { rec, lock: ghost, backend: BACKEND }), { code: "lock_unknown" });

  const voided = await locked();
  sql("INSERT INTO batch_voids (org_id, batch_id, voided_at) VALUES (?, ?, '2026-09-25T10:00:00.000Z')", ORG, voided.id);
  await assert.rejects(recordApproval(db, RING, { rec: voided, lock: (await currentLock(db, ORG, voided.id))!, backend: BACKEND }), { code: "batch_voided" });

  const sent = await locked();
  const at = "2026-09-25T10:00:00.000Z";
  sql("INSERT INTO submissions (org_id, nonce, batch_id, batch_digest, state, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'unknown_outcome', 1, ?, ?)", ORG, `batch/${sent.id}`, sent.id, "a".repeat(64), at, at);
  await assert.rejects(recordApproval(db, RING, { rec: sent, lock: (await currentLock(db, ORG, sent.id))!, backend: BACKEND }), { code: "batch_frozen" });
  const refused = await locked();
  sql("INSERT INTO submissions (org_id, nonce, batch_id, batch_digest, state, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'failed_retryable', 1, ?, ?)", ORG, `batch/${refused.id}`, refused.id, "a".repeat(64), at, at);
  assert.ok(await recordApproval(db, RING, { rec: refused, lock: (await currentLock(db, ORG, refused.id))!, backend: BACKEND }), "a refused attempt sent nothing: its retry can be approved");
});

test("the approval key is not the sealing key (HKDF with its own info), and is per org and per key", () => {
  const ring = new Keyring([K1, K2]);
  assert.notDeepEqual(ring.approvalKey("k1", ORG), ring.orgKey("k1", ORG));
  assert.notDeepEqual(ring.approvalKey("k1", ORG), ring.approvalKey("k1", "other-org"));
  assert.notDeepEqual(ring.approvalKey("k1", ORG), ring.approvalKey("k2", ORG));
  assert.throws(() => ring.approvalKey("k9", ORG), { code: "seal_unknown_kid" });
});
