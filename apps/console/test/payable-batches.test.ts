// A batch made from payables (slice H5a): converted exactly at one quote recorded as the batch's only lock, in one
// transaction; every line copies its payable's facts; a payable is in at most one batch; the rate is fixed; and the
// schema holds all of it whatever writes the database.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BatchInvalidError, createBatch, createBatchFromPayables, createPayable, createRecipient, currentLock, getBatch, listQuotes, migrateDb, openDb,
  rateFixed, recordQuote, usdCentsToZat, type ConsoleDb,
} from "../lib/index.ts";
import { usdText } from "../lib/view/format.ts";

const ORG = "org-h5";
const UA = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
const quote = (bid = "31.41592") => ({ source: "kraken" as const, pair: "XZECZUSD" as const, bid, ask: bid, last: bid, rate: bid, fetchedAt: "2026-09-23T07:00:00.000Z", host: "api.kraken.com" });

let dir: string;
let db: ConsoleDb;
let alice: string;
let bob: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h5-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
  alice = (await createRecipient(db, { orgId: ORG, network: "regtest", displayName: "Alice", address: UA[0] })).id;
  bob = (await createRecipient(db, { orgId: ORG, network: "regtest", displayName: "Bob", address: UA[1] })).id;
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const payable = async (cents: number, recipientId = alice, orgId = ORG) => createPayable(db, { orgId, recipientId, kind: "invoice", usdCents: cents, reference: `H5-${++n}` });
const make = (payableIds: string[], over: { title?: string; bid?: string } = {}) => createBatchFromPayables(db, { orgId: ORG, network: "regtest", title: over.title ?? "September", payableIds, quote: quote(over.bid) });
const codes = async (p: Promise<unknown>) => {
  try {
    await p;
    return [];
  } catch (e) {
    assert.ok(e instanceof BatchInvalidError, String(e));
    return e.problems.map((x) => `${x.code}${x.itemIndex === undefined ? "" : `@${x.itemIndex}`}`).sort();
  }
};
const count = (table: string) => db.$client.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

test("each payable becomes a line: its recipient's name and address, its reference as memo, its cents, and zat converted exactly", async () => {
  const [a, b, c] = [await payable(2_500), await payable(29, bob), await payable(99_999_999)];
  const { batch, lock } = await make([b.id, a.id, c.id], { bid: "31.41592" });
  assert.deepEqual(batch.items.map((i) => [i.idx, i.payableId, i.label, i.address, i.memo, i.usdCents, i.payableRef]), [
    [0, b.id, "Bob", UA[1], b.reference, 29, b.id],
    [1, a.id, "Alice", UA[0], a.reference, 2_500, a.id],
    [2, c.id, "Alice", UA[0], c.reference, 99_999_999, c.id],
  ], "in request order");
  assert.deepEqual(batch.items.map((i) => i.zat), [usdCentsToZat(29, "31.41592"), 79_577_488n, usdCentsToZat(99_999_999, "31.41592")]);
  assert.deepEqual(await getBatch(db, ORG, batch.id), batch, "read back exactly");
  assert.equal(rateFixed(batch), true);
  assert.deepEqual({ ...lock, recordedAt: undefined }, { seq: 1, purpose: "lock", source: "kraken", pair: "XZECZUSD", bid: "31.41592", ask: "31.41592", last: "31.41592", rate: "31.41592", fetchedAt: "2026-09-23T07:00:00.000Z", recordedAt: undefined, host: "api.kraken.com" });
  assert.deepEqual(await currentLock(db, ORG, batch.id), lock, "the lock of record is the batch's only lock");
  for (const it of batch.items) assert.equal(usdText(it.zat, lock.rate), `$${Math.floor(it.usdCents! / 100).toLocaleString("en-US")}.${String(it.usdCents! % 100).padStart(2, "0")}`, "USD at lock = the payable's dollars");
  assert.equal(rateFixed((await createBatch(db, { orgId: ORG, network: "regtest", title: "hand-made", items: [{ payableId: "x", address: UA[0], zat: 5n, memo: "M" }] }))), false, "a hand-made batch is not fixed");
});

test("problems are listed together before anything is written: title, count, repeated, unknown, taken, another org's", async () => {
  const held = await payable(100);
  const first = await make([held.id]);
  const free = await payable(200);
  const carol = (await createRecipient(db, { orgId: "org-other", network: "regtest", displayName: "Carol", address: UA[0] })).id;
  const foreign = await payable(300, carol, "org-other");
  const [batches, quotes] = [count("batches"), count("rate_quotes")];
  assert.deepEqual(await codes(make([free.id, free.id, "01900000-0000-7000-8000-000000000000", held.id, foreign.id], { title: "" })),
    ["payable_repeated@1", "payable_taken@3", "payable_unknown@2", "payable_unknown@4", "title_invalid"].sort());
  const taken = await make([held.id]).catch((e: BatchInvalidError) => e.problems[0].detail);
  assert.match(String(taken), new RegExp(`already in batch ${first.batch.id}`), "names the batch that holds it");
  assert.deepEqual(await codes(make([])), ["empty_batch"]);
  assert.deepEqual(await codes(make(Array.from({ length: 51 }, (_, i) => `01900000-0000-7000-8000-${String(i).padStart(12, "0")}`))).then((c) => c.filter((x) => !x.startsWith("payable_unknown"))), ["too_many_recipients"]);
  assert.deepEqual([count("batches"), count("rate_quotes")], [batches, quotes], "nothing written");
});

test("a conversion outside 1..2.1e15 zatoshi is that line's problem, and nothing is written", async () => {
  const cent = await payable(1);
  const big = await payable(99_999_999);
  const [batches, quotes] = [count("batches"), count("rate_quotes")];
  assert.deepEqual(await codes(make([cent.id], { bid: "2000000" })), ["amount_out_of_range@0"], "a cent under a zatoshi");
  // At $0.00000001/ZEC one cent is 10^6 ZEC (10^14 zat, allowed); $999,999.99 is 10^14 ZEC, over the 21M supply.
  assert.deepEqual(await codes(make([cent.id, big.id], { bid: "0.00000001" })), ["amount_out_of_range@1"], "more than the supply");
  assert.deepEqual([count("batches"), count("rate_quotes")], [batches, quotes]);
  assert.ok(await make([cent.id, big.id], { bid: "1600.00" }), "the same payables at a sane rate");
});

test("the rate is fixed: a second lock is refused by the trigger, whatever writes it; execution quotes still record", async () => {
  const { batch } = await make([(await payable(5_000)).id]);
  await assert.rejects(recordQuote(db, { orgId: ORG, batchId: batch.id, purpose: "lock", quote: quote("40.00") }), (e: { code?: string }) => e.code === "rate_fixed", "the trigger's refusal, mapped to rate_fixed");
  assert.throws(() => db.$client.prepare("INSERT INTO rate_quotes (org_id, batch_id, seq, purpose, source, pair, bid, ask, last, rate, fetched_at, recorded_at) VALUES (?, ?, 9, 'lock', 'kraken', 'XZECZUSD', '40.00', '40.00', '40.00', '40.00', '2026-09-23T07:00:00.000Z', '2026-09-23T07:00:00.000Z')").run(ORG, batch.id), /rate is fixed: the batch was made from payables/, "raw SQL too");
  assert.ok(await recordQuote(db, { orgId: ORG, batchId: batch.id, purpose: "execution", quote: quote("40.00") }), "the guard's execution quote");
  assert.deepEqual((await listQuotes(db, ORG, batch.id)).map((q) => [q.seq, q.purpose]), [[1, "lock"], [2, "execution"]]);
});

test("the schema: a line naming a payable carries its facts, before the lock; neither changes; a batched payable is kept; one batch per payable", async () => {
  const p = await payable(700);
  const { batch } = await make([(await payable(800)).id]);
  const { batch: open } = { batch: await createBatch(db, { orgId: ORG, network: "regtest", title: "raw", items: [{ payableId: "m", address: UA[0], zat: 5n, memo: "MANUAL" }] }) };
  const line = (batchId: string, over: Record<string, unknown>) =>
    db.$client.prepare("INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo, payable_ref, usd_cents) VALUES (@org, @batch, @idx, @pid, '', @address, 5, @memo, @ref, @cents)")
      .run({ org: ORG, batch: batchId, idx: 9, pid: p.id, address: UA[0], memo: p.reference, ref: p.id, cents: 700, ...over });
  assert.throws(() => line(open.id, { memo: "WRONG" }), /carry an existing payable's reference and cents/, "memo must be the reference");
  assert.throws(() => line(open.id, { cents: 701 }), /carry an existing payable's reference and cents/, "cents must be the payable's");
  assert.throws(() => line(open.id, { ref: "01900000-0000-7000-8000-000000000000" }), /carry an existing payable's reference and cents/, "the payable must exist");
  assert.throws(() => line(open.id, { cents: null }), /carry an existing payable's reference and cents/, "a payable line without cents (the trigger runs first)");
  assert.throws(() => line(open.id, { ref: null, idx: 11, pid: "hand-11", memo: "CENTS-ONLY" }), /CHECK constraint failed: batch_items_usd_cents/, "cents without a payable (the CHECK: both or neither)");
  assert.throws(() => line(batch.id, {}), /before the batch is locked/, "no payable line after the lock");
  line(open.id, {});
  // A second line for the payable, in another live batch, carries its reference as memo (0017), so its memo claim
  // (0019, which replaced 0018's index) refuses it: one live batch per payable.
  const other = await createBatch(db, { orgId: ORG, network: "regtest", title: "raw other", items: [{ payableId: "o", address: UA[0], zat: 5n, memo: "OTHER-LIVE" }] });
  assert.throws(() => line(other.id, { idx: 10 }), /UNIQUE constraint failed: memo_claims\.org_id, memo_claims\.memo/, "one live batch per payable");
  for (const set of ["memo = 'X'", "usd_cents = 1", "payable_ref = NULL, usd_cents = NULL"]) {
    assert.throws(() => db.$client.prepare(`UPDATE batch_items SET ${set} WHERE org_id = ? AND batch_id = ? AND idx = 9`).run(ORG, open.id), /its payable, cents and memo are fixed/, set);
  }
  db.$client.prepare("UPDATE batch_items SET memo = 'MANUAL-2' WHERE org_id = ? AND batch_id = ? AND idx = 0").run(ORG, open.id);
  assert.throws(() => db.$client.prepare("UPDATE payables SET usd_cents = 1 WHERE id = ?").run(p.id), /payable is in a batch: it cannot change/);
  assert.throws(() => db.$client.prepare("DELETE FROM payables WHERE id = ?").run(p.id), /payable is in a batch: it cannot be deleted/);
  const loose = await payable(900);
  db.$client.prepare("UPDATE payables SET usd_cents = 901 WHERE id = ?").run(loose.id);
  db.$client.prepare("DELETE FROM payables WHERE id = ?").run(loose.id);
});

test("review H5a round 1: one obligation cannot sit in a hand-made batch and a payables batch, in either order", async () => {
  const hand = (memo: string, payableId = `hand-${memo}`) => createBatch(db, { orgId: ORG, network: "regtest", title: `hand ${memo}`, items: [{ payableId, address: UA[0], zat: 5n, memo }] });
  // Hand-made first: a line typed as "INV-7" before the payable existed; the payable then cannot be batched.
  const typed = await hand("INV-7");
  const seven = await createPayable(db, { orgId: ORG, recipientId: alice, kind: "invoice", usdCents: 700, reference: "INV-7" });
  const early = await make([seven.id]).catch((e: BatchInvalidError) => e.problems);
  assert.deepEqual((early as { code: string }[]).map((p) => p.code), ["payable_taken"]);
  assert.match((early as { detail: string }[])[0].detail, new RegExp(`already in batch ${typed.id}`), "names the hand-made batch");
  // Payables first: a batch from payables, then a hand-made line with the payable's reference or its id.
  const eight = await payable(800);
  const { batch } = await make([eight.id]);
  assert.deepEqual(await codes(hand(eight.reference)), ["memo_taken@0", "payable_reserved@0"]);
  assert.match(String(await hand(eight.reference).then(() => "created", (e: BatchInvalidError) => e.problems[0].detail)), new RegExp(`already used by batch ${batch.id}`));
  assert.deepEqual(await codes(hand("OTHER-MEMO", eight.id)), ["payable_reserved@0"], "its id under another memo");
  // A free payable cannot be paid by hand either: it is paid only through a batch from payables.
  const nine = await payable(900);
  assert.deepEqual(await codes(hand(nine.reference)), ["payable_reserved@0"]);
  // Two hand-made batches cannot share a memo (a memo is a reference, unique in the org).
  await hand("HAND-ONCE");
  assert.deepEqual(await codes(hand("HAND-ONCE")), ["memo_taken@0"]);
  assert.ok(await createBatch(db, { orgId: "org-elsewhere", network: "regtest", title: "other org", items: [{ payableId: "x", address: UA[0], zat: 5n, memo: "HAND-ONCE" }] }), "another org may use it");
});

test("review H5a round 1: the schema backs it whatever writes the database (a hand-made line with a payable's reference or id; a memo used twice)", async () => {
  const p = await payable(1_000);
  const b = await createBatch(db, { orgId: ORG, network: "regtest", title: "raw hand", items: [{ payableId: "raw-0", address: UA[0], zat: 5n, memo: "RAW-HAND-0" }] });
  const line = (idx: number, pid: string, memo: string) =>
    db.$client.prepare("INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES (?, ?, ?, ?, '', ?, 5, ?)").run(ORG, b.id, idx, pid, UA[0], memo);
  assert.throws(() => line(1, "raw-1", p.reference), /a hand-made line cannot pay a payable/, "its reference");
  assert.throws(() => line(2, p.id, "RAW-HAND-2"), /a hand-made line cannot pay a payable/, "its id");
  const other = await createBatch(db, { orgId: ORG, network: "regtest", title: "raw other", items: [{ payableId: "raw-o", address: UA[0], zat: 5n, memo: "RAW-OTHER" }] });
  assert.throws(() => db.$client.prepare("INSERT INTO batch_items (org_id, batch_id, idx, payable_id, label, address, zat, memo) VALUES (?, ?, 1, 'raw-x', '', ?, 5, 'RAW-HAND-0')").run(ORG, other.id, UA[0]), /UNIQUE constraint failed: memo_claims\.org_id, memo_claims\.memo/, "a memo used by another batch (its claim, 0019)");
});
