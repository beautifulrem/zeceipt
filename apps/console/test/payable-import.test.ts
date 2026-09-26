// The zecpay import's write (slice I3b; REQ-CON-19; `05` §3.6): the preview writes nothing; the confirm writes the
// previewed plan in one transaction, or nothing when the data changed since, or when any insert fails.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPayable, createRecipient, migrateDb, openDb, type ConsoleDb } from "../lib/index.ts";
import { ImportEmptyError, ImportPlanChangedError, previewZecpayImport, writeZecpayImport, type ZecpayImportInput } from "../lib/data/payable-import.ts";

const UA = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
let dir: string;
let db: ConsoleDb;
let n = 0;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-import-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const count = (table: string, org: string) => (db.$client.prepare(`SELECT count(*) AS c FROM ${table} WHERE org_id = ?`).get(org) as { c: number }).c;
const input = (csv: string, over: Partial<ZecpayImportInput> = {}): ZecpayImportInput => ({ orgId: `org-${++n}`, network: "regtest", kind: "salary", prefix: "PAY-09", csv, ...over });
const csv3 = `name,wallet,amount\nAlice,${UA[0]},500\nBob,${UA[1]},227.50\nAlice (2),${UA[0]},10`;

test("preview writes nothing; confirm writes each new recipient once per receiver, then every payable, logged in the record trail", async () => {
  const inp = input(csv3);
  const { plan, fingerprint } = await previewZecpayImport(db, inp);
  assert.equal(plan.payables.length, 3);
  assert.deepEqual([count("recipients", inp.orgId), count("payables", inp.orgId)], [0, 0], "the preview wrote nothing");
  const out = await writeZecpayImport(db, inp, fingerprint);
  assert.deepEqual([out.recipients, out.payables], [2, 3]);
  const rows = db.$client.prepare("SELECT p.reference, p.usd_cents AS cents, p.kind, r.display_name AS name FROM payables p JOIN recipients r ON r.org_id = p.org_id AND r.id = p.recipient_id WHERE p.org_id = ? ORDER BY p.reference").all(inp.orgId);
  assert.deepEqual(rows, [
    { reference: "PAY-09-2", cents: 50000, kind: "salary", name: "Alice" },
    { reference: "PAY-09-3", cents: 22750, kind: "salary", name: "Bob" },
    { reference: "PAY-09-4", cents: 1000, kind: "salary", name: "Alice" },
  ]);
  assert.equal(count("recipients", inp.orgId), 2, "Alice's two rows share one new recipient");
  const log = db.$client.prepare("SELECT kind, action FROM record_log WHERE org_id = ? ORDER BY id").all(inp.orgId) as { kind: string; action: string }[];
  assert.deepEqual(log.map((l) => `${l.kind}:${l.action}`), ["recipient:created", "payable:created", "recipient:created", "payable:created", "payable:created"], "in file order, the record trail's triggers logged each insert");
});

test("an existing recipient paying the same place is used, not duplicated", async () => {
  const inp = input(`name,wallet,amount\nA. Smith,${UA[2]},5`);
  const existing = await createRecipient(db, { orgId: inp.orgId, network: "regtest", displayName: "Alice Smith", address: UA[2] });
  const { fingerprint } = await previewZecpayImport(db, inp);
  const out = await writeZecpayImport(db, inp, fingerprint);
  assert.deepEqual([out.recipients, out.payables, count("recipients", inp.orgId)], [0, 1, 1]);
  const row = db.$client.prepare("SELECT recipient_id AS r FROM payables WHERE org_id = ?").get(inp.orgId) as { r: string };
  assert.equal(row.r, existing.id);
});

test("the data changed since the preview (a reference taken): nothing is written, and the operator is told to preview again", async () => {
  const inp = input(csv3);
  const { fingerprint } = await previewZecpayImport(db, inp);
  const someone = await createRecipient(db, { orgId: inp.orgId, network: "regtest", displayName: "Other", address: UA[2] });
  await createPayable(db, { orgId: inp.orgId, recipientId: someone.id, kind: "invoice", usdCents: 1, reference: "PAY-09-3" });
  await assert.rejects(writeZecpayImport(db, inp, fingerprint), ImportPlanChangedError);
  assert.deepEqual([count("recipients", inp.orgId), count("payables", inp.orgId)], [1, 1], "only what the other writer added");
});

test("all or none: an insert failing half-way rolls back every recipient and payable already written", async () => {
  const inp = input(csv3);
  const { fingerprint } = await previewZecpayImport(db, inp);
  let i = 0;
  const ids = ["0192f0e2-0000-7000-8000-00000000000a", "0192f0e2-0000-7000-8000-00000000000b", "0192f0e2-0000-7000-8000-00000000000b"];
  await assert.rejects(writeZecpayImport(db, inp, fingerprint, { newId: () => ids[i++] ?? "0192f0e2-0000-7000-8000-00000000000c" }));
  assert.deepEqual([count("recipients", inp.orgId), count("payables", inp.orgId)], [0, 0], "the first recipient and payable were rolled back");
});

test("nothing to import: a file problem or every row refused is refused, and nothing is written", async () => {
  const bad = input(`Alice,${UA[0]},500`);
  const a = await previewZecpayImport(db, bad);
  await assert.rejects(writeZecpayImport(db, bad, a.fingerprint), ImportEmptyError);
  const refused = input(`name,wallet,amount\nA,zs1abc,5`);
  const b = await previewZecpayImport(db, refused);
  await assert.rejects(writeZecpayImport(db, refused, b.fingerprint), (e: unknown) => e instanceof ImportEmptyError && /no row can be imported/.test(e.message));
  assert.equal(count("payables", refused.orgId), 0);
});

test("a fingerprint from another file or another prefix is not accepted", async () => {
  const inp = input(csv3);
  const { fingerprint } = await previewZecpayImport(db, inp);
  await assert.rejects(writeZecpayImport(db, { ...inp, prefix: "OTHER" }, fingerprint), ImportPlanChangedError);
  await assert.rejects(writeZecpayImport(db, { ...inp, csv: csv3 + `\nEve,${UA[2]},1` }, fingerprint), ImportPlanChangedError);
  assert.equal(count("payables", inp.orgId), 0);
});
