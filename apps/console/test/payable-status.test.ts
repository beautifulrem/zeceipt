// Where each payable is (slice H5b): free, or held by a batch, by the rule H5a's payable_taken applies.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBatch, createBatchFromPayables, createPayable, createRecipient, migrateDb, openDb, type ConsoleDb } from "../lib/index.ts";
import { payableHolders } from "../lib/data/payable-status.ts";

const ORG = "org-h5b";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
let dir: string;
let db: ConsoleDb;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h5b-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

test("free, held through a batch from payables, or held by a hand-made line typed before the payable existed; scoped to the org", async () => {
  const alice = (await createRecipient(db, { orgId: ORG, network: "regtest", displayName: "Alice", address: UA })).id;
  const typed = await createBatch(db, { orgId: ORG, network: "regtest", title: "Typed early", items: [{ payableId: "t-1", address: UA, zat: 5n, memo: "EARLY-1" }] });
  const early = await createPayable(db, { orgId: ORG, recipientId: alice, kind: "invoice", usdCents: 100, reference: "EARLY-1" });
  const [a, free] = [await createPayable(db, { orgId: ORG, recipientId: alice, kind: "bounty", usdCents: 200, reference: "B-1" }), await createPayable(db, { orgId: ORG, recipientId: alice, kind: "salary", usdCents: 300, reference: "S-1" })];
  const { batch } = await createBatchFromPayables(db, { orgId: ORG, network: "regtest", title: "September", payableIds: [a.id], quote: { source: "kraken", pair: "XZECZUSD", bid: "1600.00", ask: "1600.00", last: "1600.00", rate: "1600.00", fetchedAt: "2026-09-25T00:00:00.000Z" } });
  const holders = await payableHolders(db, ORG);
  assert.deepEqual(holders.get(a.id), { batchId: batch.id, title: "September" });
  assert.deepEqual(holders.get(early.id), { batchId: typed.id, title: "Typed early" }, "the memo rule");
  assert.equal(holders.has(free.id), false);
  assert.equal((await payableHolders(db, "org-other")).size, 0);
});
