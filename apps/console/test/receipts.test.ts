// Receipts at rest (slice B2): real receipts from the `zeceipt` binary on the committed Zkool fixture
// (tx 48db254a…, 3 recipients, PROOF §5b) are recorded against a matching batch, listed back decrypted,
// still verify, and are sealed so the stored row holds neither the OCK nor the URL. Plus the refusal
// paths, schema rules and triggers, AAD binding, and key rotation.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  autoIssue,
  BatchInvalidError,
  batchDigest,
  batchNonce,
  createBatch,
  Keyring,
  listReceipts,
  migrateDb,
  openDb,
  recordReceipts,
  ReceiptRecordError,
  rewrapReceipts,
  SealError,
  sealedKidsInUse,
  SqliteIdempotencyStore,
  toExecutionBatch,
  type AutoIssueResult,
  type BatchRecord,
  type ConsoleDb,
} from "../lib/index.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const RAW = join(ROOT, `fixtures/regtest-${TXID}.hex`);
const UFVK = join(ROOT, "fixtures/regtest-issuer-ufvk.txt");
const ORG = "org-b2";
const PAYEES = [
  { payableId: "p-2", label: "R2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: 101_000_000n, memo: "INV-R-002" },
  { payableId: "p-3", label: "R3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: 102_000_000n, memo: "INV-R-003" },
  { payableId: "p-4", label: "R4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: 103_000_000n, memo: "INV-R-004" },
];
const k1 = { kid: "k1", key: Buffer.alloc(32, 0x11) };
const k2 = { kid: "k2", key: Buffer.alloc(32, 0x22) };

let dir: string;
let db: ConsoleDb;
let dbPath: string;
let keyFile: string;

before(async () => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN}`);
  dir = await mkdtemp(join(tmpdir(), "zeceipt-b2-"));
  dbPath = join(dir, "console.db");
  db = openDb({ path: dbPath });
  migrateDb(db);
  keyFile = join(dir, "issuer.key");
  execFileSync(BIN, ["keygen", "--out", keyFile]);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

/** A batch matching the fixture, its submission broadcast as the fixture tx, and real receipts for it. */
async function issuedBatch(title: string, opts: { broadcast?: string | null; org?: string } = {}): Promise<{ rec: BatchRecord; issued: Extract<AutoIssueResult, { state: "issued" }> }> {
  const org = opts.org ?? `${ORG}-${title}`; // one org per scenario: an output holds one receipt per org
  const rec = await createBatch(db, { orgId: org, network: "regtest", title, items: PAYEES });
  const store = new SqliteIdempotencyStore(db, { orgId: org });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "t", attempts: 1 };
  if (opts.broadcast !== null) {
    await store.createIntent({ ...base, state: "submitting" });
    await store.update({ ...base, state: "broadcast", txid: opts.broadcast ?? TXID }, { attempts: 1, states: ["submitting"] });
  }
  const out = await autoIssue({
    batch: toExecutionBatch(rec),
    txid: TXID,
    status: { state: "mined", height: 626, confirmations: 3, tip: 628 },
    requiredConfirmations: 1,
    cli: { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile, keyId: "2026-09", challenge: `ch-${title}` },
  });
  assert.equal(out.state, "issued");
  return { rec, issued: out as Extract<AutoIssueResult, { state: "issued" }> };
}
const orgOf = (rec: BatchRecord) => rec.orgId;

const count = () => (db.$client.prepare("SELECT count(*) AS n FROM receipts").get() as { n: number }).n;

test("record → list: three real receipts, decrypted back intact, still verifying; the stored row holds neither OCK nor URL", async () => {
  const ring = new Keyring([k1]);
  const { rec, issued } = await issuedBatch("record");
  assert.deepEqual(await recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued }), { inserted: [0, 1, 2], existing: [] });
  const listed = await listReceipts(db, ring, orgOf(rec), rec.id);
  assert.deepEqual(listed.map((r) => [r.idx, r.payableId, r.memo, r.valueZat, r.txid, r.sealedKid]), PAYEES.map((p, i) => [i, p.payableId, p.memo, p.zat, TXID, "k1"]));
  for (const r of listed) {
    const src = issued.receipts.find((x) => x.payableId === r.payableId)!;
    assert.deepEqual(r.receipt, src.receipt);
    assert.equal(r.url, src.url);
    assert.equal(r.outputIndex, src.recovered.index);
    assert.equal(r.recipient, src.recovered.recipient);
  }
  // The decrypted receipt still verifies with the real binary.
  const f = join(dir, "listed-receipt.json");
  await writeFile(f, JSON.stringify(listed[1].receipt));
  const v = JSON.parse(execFileSync(BIN, ["verify", "--regtest", "--raw-tx-file", RAW, f, "--challenge", "ch-record", "--require-signature"]).toString());
  assert.equal(v.valid, true);
  // At rest: no OCK, no URL, no receipt JSON in any stored column.
  const rows = db.$client.prepare("SELECT * FROM receipts WHERE batch_id = ?").all(rec.id) as Record<string, unknown>[];
  for (const [i, row] of rows.entries()) {
    const text = JSON.stringify(row);
    const ock = listed[i].receipt!.ock as string;
    assert.ok(ock && !text.includes(ock), "OCK must not be stored in plaintext");
    const link = new URL(listed[i].url!);
    const payload = link.hash.slice(1); // the receipt payload rides in the fragment (spec §2)
    assert.ok(link.pathname.endsWith("/r") && payload.length > 40, `a fragment link: ${link.origin}${link.pathname}`);
    assert.ok(!text.includes(payload.slice(0, 40)), "URL payload must not be stored in plaintext");
  }
});

test("recording is idempotent: a second run (even with new receipts) keeps the first and reports them as existing", async () => {
  const ring = new Keyring([k1]);
  const { rec, issued } = await issuedBatch("again");
  await recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued });
  const before = await listReceipts(db, ring, orgOf(rec), rec.id);
  const reissued = await autoIssue({
    batch: toExecutionBatch(rec),
    txid: TXID,
    status: { state: "mined", height: 626, confirmations: 3, tip: 628 },
    requiredConfirmations: 1,
    cli: { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile, keyId: "2026-09", challenge: "another-challenge" },
  });
  assert.deepEqual(await recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued: reissued as Extract<AutoIssueResult, { state: "issued" }> }), { inserted: [], existing: [0, 1, 2] });
  assert.deepEqual((await listReceipts(db, ring, orgOf(rec), rec.id)).map((r) => r.receipt), before.map((r) => r.receipt), "the first receipts stay");
});

test("recording refuses receipts that do not belong to the batch's own broadcast, and writes nothing", async () => {
  const ring = new Keyring([k1]);
  const start = count();
  const code = (c: string) => (e: unknown) => e instanceof ReceiptRecordError && e.code === c;
  const { rec: unsent, issued: forUnsent } = await issuedBatch("unsent", { broadcast: null });
  await assert.rejects(recordReceipts(db, ring, { orgId: orgOf(unsent), batchId: unsent.id, issued: forUnsent }), code("batch_not_broadcast"));
  const { rec: other, issued: forOther } = await issuedBatch("other-tx", { broadcast: "cd".repeat(32) });
  await assert.rejects(recordReceipts(db, ring, { orgId: orgOf(other), batchId: other.id, issued: forOther }), code("batch_not_broadcast"));
  await assert.rejects(recordReceipts(db, ring, { orgId: orgOf(other), batchId: "00000000-0000-7000-8000-000000000000", issued: forOther }), code("batch_unknown"));
  const { rec, issued } = await issuedBatch("mismatch");
  const mutate = (i: number, f: (r: (typeof issued.receipts)[number]) => void) => {
    const copy = structuredClone(issued);
    f(copy.receipts[i]);
    return copy;
  };
  const bad = [
    mutate(0, (r) => void (r.recovered.memo.text = "INV-OTHER")),
    mutate(1, (r) => void (r.recovered.value_zat += 1)),
    mutate(2, (r) => void (r.payableId = "p-unknown")),
    mutate(2, (r) => void (r.payableId = "p-2")), // two receipts for one item
    mutate(0, (r) => void (r.receipt.txid = "ef".repeat(32))),
    mutate(0, (r) => void (r.recovered.pool = "transparent")),
  ];
  for (const b of bad) await assert.rejects(recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued: b }), code("receipt_mismatch"));
  assert.equal(count(), start);
});

test("the schema refuses impossible receipts; receipts cannot be deleted or changed except for re-wrapping, on any connection", async () => {
  const ring = new Keyring([k1]);
  const { rec, issued } = await issuedBatch("schema");
  await recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued });
  const ins = db.$client.prepare("INSERT INTO receipts (org_id, txid, pool, output_index, batch_id, idx, value_zat, recipient, memo_text, issued_at, verified_at, sealed, sealed_kid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const env = JSON.stringify({ v: 1, kid: "k1", iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA", ct: "AA" });
  const row = (over: Record<number, unknown>) => {
    const v: unknown[] = [orgOf(rec), TXID, "ironwood", 7, rec.id, 0, 1, "uregtest1x", "m", "t", "t", env, "k1"];
    for (const [i, x] of Object.entries(over)) v[Number(i)] = x;
    return () => ins.run(...v);
  };
  const c = (want: string) => (e: unknown) => (e as { code?: string }).code === want;
  assert.throws(row({ 2: "transparent" }), c("SQLITE_CONSTRAINT_CHECK"), "pool");
  assert.throws(row({ 3: -1 }), c("SQLITE_CONSTRAINT_CHECK"), "index");
  assert.throws(row({ 1: "XX".repeat(32) }), c("SQLITE_CONSTRAINT_TRIGGER"), "txid (not the batch's broadcast)");
  assert.throws(row({ 1: "aa".repeat(32) }), (e: unknown) => /own broadcast/.test(String((e as Error).message)), "another txid");
  assert.throws(row({ 11: "{}" }), /not a valid envelope/, "sealed not an envelope");
  assert.throws(row({ 11: "garbage" }), /not a valid envelope/, "sealed not JSON");
  assert.throws(row({ 12: "k2" }), /not a valid envelope/, "sealed_kid differs from the envelope's kid");
  assert.throws(row({ 6: 0 }), c("SQLITE_CONSTRAINT_CHECK"), "value");
  assert.throws(row({ 5: 9 }), c("SQLITE_CONSTRAINT_FOREIGNKEY"), "no such item");
  assert.throws(row({}), c("SQLITE_CONSTRAINT_UNIQUE"), "a second receipt for item 0");
  const key = [orgOf(rec), rec.id];
  assert.throws(() => db.$client.prepare("DELETE FROM receipts WHERE org_id = ? AND batch_id = ?").run(...key), /never deleted/);
  assert.throws(() => db.$client.prepare("UPDATE receipts SET value_zat = 5 WHERE org_id = ? AND batch_id = ? AND idx = 0").run(...key), /never changes/);
  assert.throws(() => db.$client.prepare("UPDATE receipts SET memo_text = 'x' WHERE org_id = ? AND batch_id = ? AND idx = 0").run(...key), /never changes/);
  // The re-wrap columns may change, but only to a well-formed envelope whose own kid matches sealed_kid.
  assert.throws(() => db.$client.prepare("UPDATE receipts SET sealed_kid = 'k2' WHERE org_id = ? AND batch_id = ? AND idx = 0").run(...key), /not a valid envelope/, "drifted kid");
  assert.throws(() => db.$client.prepare("UPDATE receipts SET sealed = 'garbage' WHERE org_id = ? AND batch_id = ? AND idx = 0").run(...key), /not a valid envelope/, "garbage payload");
  // A duplicated key would make SQLite (first occurrence) and JSON.parse (last) read different kids.
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = '{"kid":"kX",' || substr(sealed, 2), sealed_kid = 'kX' WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "duplicate kid key");
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = json_set(sealed, '$.v', json('true')) WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "v = true");
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = json_set(sealed, '$.extra', 1) WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "extra field");
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = json_set(sealed, '$.kid', 1), sealed_kid = '1' WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "numeric kid");
  // Five keys in total but a required one missing: the check must not evaluate to NULL and let the row through.
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = json_remove(json_set(sealed, '$.x', 'y'), '$.ct') WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "ct replaced by x");
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = json_remove(json_set(sealed, '$.x', 1), '$.v') WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "v replaced by x");
  assert.throws(() => db.$client.prepare(`UPDATE receipts SET sealed = '{"k\\u0069d":"kY",' || substr(json_remove(sealed, '$.tag'), 2), sealed_kid = 'kY' WHERE org_id = ? AND batch_id = ? AND idx = 0`).run(...key), /not a valid envelope/, "escaped duplicate kid in place of tag");
  const raw = new Database(dbPath); // recursive triggers OFF
  try {
    const r = raw.prepare("INSERT OR REPLACE INTO receipts (org_id, txid, pool, output_index, batch_id, idx, value_zat, recipient, memo_text, issued_at, verified_at, sealed, sealed_kid) SELECT org_id, txid, pool, output_index, batch_id, idx, 1, 'evil', 'evil', 't', 't', sealed, sealed_kid FROM receipts WHERE org_id = ? AND batch_id = ? AND idx = 0").run(...key);
    assert.equal(r.changes, 0);
    assert.throws(() => raw.prepare("DELETE FROM receipts WHERE org_id = ? AND batch_id = ?").run(...key), /never deleted/);
  } finally {
    raw.close();
  }
  const kept = await listReceipts(db, ring, orgOf(rec), rec.id);
  assert.deepEqual(kept.map((r) => [r.valueZat, r.memo]), PAYEES.map((p) => [p.zat, p.memo]));
});

test("a sealed payload moved to another row does not open there (the row identity is the AAD)", async () => {
  const ring = new Keyring([k1]);
  const { rec, issued } = await issuedBatch("swap");
  await recordReceipts(db, ring, { orgId: orgOf(rec), batchId: rec.id, issued });
  // Re-wrapping is the one allowed update; abuse it to copy item 0's sealed payload onto item 1.
  db.$client.prepare("UPDATE receipts SET sealed = (SELECT sealed FROM receipts WHERE org_id = ? AND batch_id = ? AND idx = 0) WHERE org_id = ? AND batch_id = ? AND idx = 1").run(orgOf(rec), rec.id, orgOf(rec), rec.id);
  const listed = await listReceipts(db, ring, orgOf(rec), rec.id);
  assert.deepEqual(listed.map((r) => [r.idx, r.openError ?? "ok", r.receipt === undefined]), [[0, "ok", false], [1, "seal_auth_failed", true], [2, "ok", false]], "the moved payload does not open; the other rows still do");
});

test("key rotation: rewrap under a new key, retire the old one, every receipt still opens", async () => {
  const org = "org-rotate";
  const rec = await createBatch(db, { orgId: org, network: "regtest", title: "rotate", items: PAYEES });
  const store = new SqliteIdempotencyStore(db, { orgId: org });
  const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: "t", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
  const out = await autoIssue({ batch: toExecutionBatch(rec), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, cli: { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile, keyId: "2026-09", challenge: "rot" } });
  await recordReceipts(db, new Keyring([k1]), { orgId: org, batchId: rec.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });
  const before = await listReceipts(db, new Keyring([k1]), org, rec.id);
  const both = new Keyring([k1, k2]);
  assert.deepEqual(await sealedKidsInUse(db).then((k) => k.includes("k1")), true, "k1 is still in use: it must not be retired yet");
  assert.equal(await rewrapReceipts(db, both, org, { limit: 2 }), 2, "chunked");
  assert.equal(await rewrapReceipts(db, both, org, { limit: 2 }), 1);
  assert.equal(await rewrapReceipts(db, both, org), 0, "nothing left under the old key");
  const after = await listReceipts(db, new Keyring([k2]), org, rec.id); // old key retired
  assert.deepEqual(after.map((r) => [r.receipt, r.url, r.sealedKid]), before.map((r) => [r.receipt, r.url, "k2"]));
  assert.deepEqual((await listReceipts(db, new Keyring([k1]), org, rec.id)).map((r) => r.openError), ["seal_unknown_kid", "seal_unknown_kid", "seal_unknown_kid"]);
  assert.ok(!(db.$client.prepare("SELECT DISTINCT json_extract(sealed, '$.kid') AS kid FROM receipts WHERE org_id = ?").all(org) as { kid: string }[]).some((r) => r.kid === "k1"));
});

test("an output already receipted for one batch cannot be receipted for another batch of the same org", async () => {
  const ring = new Keyring([k1]);
  const org = "org-b2-shared";
  const first = await issuedBatch("shared-1", { org });
  await recordReceipts(db, ring, { orgId: org, batchId: first.rec.id, issued: first.issued });
  // Two batches of one org can no longer carry the same outputs: memos are unique across the org's batches (review
  // H5a round 1, migration 0018), so an identical second batch is refused at creation.
  await assert.rejects(issuedBatch("shared-2", { org }), (e: unknown) => e instanceof BatchInvalidError && e.problems.every((p) => p.code === "memo_taken") && e.problems[0].detail.includes(`already used by batch ${first.rec.id}`));
  // The receipt guard stays for a crafted `issued` (review H5a round 2): a second batch with its own memos, recorded as
  // broadcast in the same transaction, whose receipts claim the outputs the first batch already holds. A real
  // verifier never recovers another batch's memos from an output; this reaches the guard directly.
  const second = await createBatch(db, { orgId: org, network: "regtest", title: "shared-2", items: PAYEES.map((p) => ({ ...p, payableId: `${p.payableId}-b`, memo: `${p.memo}-b` })) });
  const store = new SqliteIdempotencyStore(db, { orgId: org });
  const base = { nonce: batchNonce(second), batchId: second.id, batchDigest: batchDigest(toExecutionBatch(second)), createdAt: "t", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
  const crafted = {
    ...first.issued,
    receipts: first.issued.receipts.map((r) => {
      const item = second.items.find((i) => i.payableId === `${r.payableId}-b`)!;
      return { ...r, payableId: item.payableId, recovered: { ...r.recovered, memo: { kind: "text" as const, text: item.memo } } };
    }),
  } as typeof first.issued;
  await assert.rejects(
    recordReceipts(db, ring, { orgId: org, batchId: second.id, issued: crafted }),
    (e: unknown) => e instanceof ReceiptRecordError && e.code === "receipt_mismatch" && e.message.includes(`already has a receipt for batch ${first.rec.id}`),
  );
  assert.deepEqual(await listReceipts(db, ring, org, second.id), []);
});

test("autoIssue never writes a receipt (OCK) to a temp file; outDir (tools only) is owner-only", async () => {
  const { readdir, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const temps = async () => (await readdir(tmpdir())).filter((f) => f.startsWith("zeceipt-verify-"));
  const before = await temps();
  const org = "org-b2-files";
  const rec = await createBatch(db, { orgId: org, network: "regtest", title: "files", items: PAYEES });
  const outDir = join(dir, "out-files");
  const out = await autoIssue({ batch: toExecutionBatch(rec), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, outDir, cli: { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile, keyId: "2026-09", challenge: "files" } });
  assert.equal(out.state, "issued");
  assert.deepEqual(await temps(), before, "no zeceipt-verify-* temp directory was created");
  assert.equal((await stat(outDir)).mode & 0o777, 0o700);
  const files = await readdir(outDir);
  assert.equal(files.length, 3);
  for (const f of files) assert.equal((await stat(join(outDir, f))).mode & 0o777, 0o600, f);
  void SealError;
});
