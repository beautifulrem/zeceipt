// The trail of recipients and payables (slice I4b; design I4b.4.1): created, changed ({previous, current} per changed
// field; a no-op or an untracked change is not an event), deleted; in the same transaction; append-only; the address
// abridged exactly as `shortAddress` does it on every network; and the backfill from a database at 0021.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPayable, createRecipient, defaultMigrationsDir, listRecordLog, migrateDb, openDb, type ConsoleDb } from "../lib/index.ts";
import { shortAddress } from "../lib/view/format.ts";

const ORG = "org-i4b";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const UA2 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
let dir: string;
let db: ConsoleDb;
let n = 0;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-i4b-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});
const sql = (text: string, ...args: unknown[]) => db.$client.prepare(text).run(...args);
const recipient = (d: ConsoleDb = db) => createRecipient(d, { orgId: ORG, network: "regtest", displayName: `Payee ${++n}`, address: UA }, { now: () => new Date("2026-09-25T10:00:00.000Z") });

test("a recipient: created, then each tracked change as {previous, current}, then deleted", async () => {
  const r = await recipient();
  sql("UPDATE recipients SET address = ?, kyc_status = 'verified', updated_at = '2026-09-25T10:05:00.000Z' WHERE id = ?", UA2, r.id);
  sql("DELETE FROM recipients WHERE id = ?", r.id);
  const events = await listRecordLog(db, ORG, "recipient", r.id);
  assert.deepEqual(events.map((e) => e.action), ["created", "changed", "deleted"]);
  assert.deepEqual([events[0].at, events[0].detail], ["2026-09-25T10:00:00.000Z", { displayName: r.displayName, network: "regtest", address: shortAddress(UA) }]);
  assert.deepEqual([events[1].at, events[1].detail], ["2026-09-25T10:05:00.000Z", {
    fields: { address: { previous: shortAddress(UA), current: shortAddress(UA2) }, kycStatus: { previous: "unknown", current: "verified" } },
  }], "only the changed fields, each with its previous and current value; the address abridged");
  assert.deepEqual(events[2].detail, { displayName: r.displayName });
  assert.match(events[2].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "a delete is stamped by the database clock, ISO with milliseconds");
  assert.ok(!JSON.stringify(events).includes(UA) && !JSON.stringify(events).includes(UA2), "never the full address");
});

test("a no-op update, or one of an untracked column (updated_at alone), is not an event", async () => {
  const r = await recipient();
  sql("UPDATE recipients SET display_name = display_name WHERE id = ?", r.id);
  sql("UPDATE recipients SET updated_at = '2026-09-25T11:00:00.000Z' WHERE id = ?", r.id);
  assert.deepEqual((await listRecordLog(db, ORG, "recipient", r.id)).map((e) => e.action), ["created"]);
  // A NULL-able field set and cleared is two changes (IS NOT, not <>).
  sql("UPDATE recipients SET notes = 'call first' WHERE id = ?", r.id);
  sql("UPDATE recipients SET notes = '' WHERE id = ?", r.id);
  const changes = (await listRecordLog(db, ORG, "recipient", r.id)).slice(1).map((e) => e.detail.fields);
  assert.equal(changes.length, 2);
  assert.deepEqual((changes[0] as Record<string, { current: unknown }>).notes.current, "call first");
});

test("a payable: created, changed (usdCents, reference), deleted while not in a batch", async () => {
  const r = await recipient();
  const p = await createPayable(db, { orgId: ORG, recipientId: r.id, kind: "invoice", usdCents: 160_000, reference: `INV-${n}` }, { now: () => new Date("2026-09-25T10:10:00.000Z") });
  sql("UPDATE payables SET usd_cents = 150000, reference = ? WHERE id = ?", `INV-${n}-B`, p.id);
  sql("DELETE FROM payables WHERE id = ?", p.id);
  const events = await listRecordLog(db, ORG, "payable", p.id);
  assert.deepEqual(events.map((e) => e.action), ["created", "changed", "deleted"]);
  assert.deepEqual(events[0].detail, { recipientId: r.id, kind: "invoice", usdCents: 160000, reference: `INV-${n}` });
  assert.deepEqual(events[1].detail, { fields: { usdCents: { previous: 160000, current: 150000 }, reference: { previous: `INV-${n}`, current: `INV-${n}-B` } } });
  assert.deepEqual(events[2].detail, { reference: `INV-${n}-B` });
});

test("in the same transaction: a rolled-back change leaves no event; the trail is append-only and holds JSON objects", async () => {
  const r = await recipient();
  assert.throws(() =>
    db.$client.transaction(() => {
      sql("UPDATE recipients SET display_name = 'Mallory' WHERE id = ?", r.id);
      throw new Error("abort");
    })(),
  );
  assert.deepEqual((await listRecordLog(db, ORG, "recipient", r.id)).map((e) => e.action), ["created"]);
  assert.throws(() => sql("UPDATE record_log SET action = 'deleted' WHERE record_id = ?", r.id), /record log is append-only/);
  assert.throws(() => sql("DELETE FROM record_log WHERE record_id = ?", r.id), /record log is append-only/);
  assert.throws(() => sql("INSERT INTO record_log (org_id, kind, record_id, at, action, detail) VALUES (?, 'recipient', 'x', 't', 'created', '1')", ORG), /CHECK constraint failed/);
});

test("the SQL abridgement equals shortAddress on every network, at and around the length threshold", async () => {
  const cases: [string, string][] = [];
  for (const [network, hrp] of [["main", "u"], ["test", "utest"], ["regtest", "uregtest"]] as const) {
    const keep = hrp.length + 1 + 25; // shortAddress keeps the prefix, the "1" and 25 data characters
    for (const len of [keep, keep + 1, keep + 2, 141]) cases.push([network, `${hrp}1${"q".repeat(len - hrp.length - 1)}`]);
  }
  for (const [network, address] of cases) {
    const id = `0190a0d6-7e3b-7c61-8d3f-${String(++n).padStart(12, "0")}`;
    sql("INSERT INTO recipients (org_id, id, display_name, address, network, kyc_status, tax_flag, settlement_pref, notes, created_at, updated_at) VALUES (?, ?, 'x', ?, ?, 'unknown', 'none', 'zec', '', '2026-09-25T10:00:00.000Z', '2026-09-25T10:00:00.000Z')", ORG, id, address, network);
    const [created] = await listRecordLog(db, ORG, "recipient", id);
    assert.equal(created.detail.address, shortAddress(address), `${network} length ${address.length}`);
  }
});

test("the migration backfills a database from before it: a created event per recipient and payable, marked backfilled", async () => {
  const old = join(dir, "migrations-0021");
  cpSync(defaultMigrationsDir(), old, { recursive: true });
  const journal = JSON.parse(readFileSync(join(old, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  for (const e of journal.entries.filter((e) => e.idx >= 22)) {
    rmSync(join(old, `${e.tag}.sql`));
    rmSync(join(old, "meta", `${e.tag.slice(0, 4)}_snapshot.json`));
  }
  journal.entries = journal.entries.filter((e) => e.idx < 22);
  writeFileSync(join(old, "meta", "_journal.json"), JSON.stringify(journal));
  const legacy = openDb({ path: join(dir, "legacy.db") });
  try {
    migrateDb(legacy, old);
    const r = await recipient(legacy);
    const p = await createPayable(legacy, { orgId: ORG, recipientId: r.id, kind: "bounty", usdCents: 5_000, reference: "OLD-1" });
    migrateDb(legacy);
    const rs = await listRecordLog(legacy, ORG, "recipient", r.id);
    const ps = await listRecordLog(legacy, ORG, "payable", p.id);
    assert.deepEqual(rs.map((e) => [e.action, e.detail.backfilled, e.detail.address]), [["created", true, shortAddress(UA)]]);
    assert.deepEqual(ps.map((e) => [e.action, e.detail.backfilled, e.detail.reference]), [["created", true, "OLD-1"]]);
    legacy.$client.prepare("UPDATE payables SET usd_cents = 6000 WHERE id = ?").run(p.id);
    assert.deepEqual((await listRecordLog(legacy, ORG, "payable", p.id)).map((e) => e.action), ["created", "changed"], "the triggers write from then on");
  } finally {
    legacy.$client.close();
  }
});
