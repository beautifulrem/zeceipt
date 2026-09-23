// Recipients (slice H1; REQ-CON-2): one address rule with batch items (the console's network, Bech32m, single
// case); duplicates flagged on read, never blocked (05); KYC and tax recorded, never gates; the schema refuses
// raw-SQL garbage on its own.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { item, ua } from "./helpers/ua-encoder.ts";
import { createRecipient, getRecipient, listRecipients, migrateDb, openDb, RecipientInvalidError, type ConsoleDb, type RecipientInput } from "../lib/index.ts";

const ORG = "org-h1";
const R = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
];
// A real mainnet unified address (the synthetic receipt's recipient): valid, but for the wrong network here.
const MAINNET = "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel";

let dir: string;
let db: ConsoleDb;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h1-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const base = (over: Partial<RecipientInput> = {}): RecipientInput => ({ orgId: ORG, network: "regtest", displayName: "Alice", address: R[0], ...over });
const problems = async (input: RecipientInput) => {
  try {
    await createRecipient(db, input);
    return [];
  } catch (e) {
    assert.ok(e instanceof RecipientInvalidError, String(e));
    return e.problems.map((p) => p.code);
  }
};

test("create and read back: defaults are unknown KYC, no tax flag, ZEC settlement; the fields round-trip exactly", async () => {
  const r = await createRecipient(db, base({ displayName: "Alice — 🦓 contractor", notes: "INV monthly" }), { now: () => new Date("2026-09-23T05:00:00.000Z") });
  assert.match(r.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  assert.deepEqual({ ...r, id: undefined }, { id: undefined, displayName: "Alice — 🦓 contractor", address: R[0], network: "regtest", kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "INV monthly", createdAt: "2026-09-23T05:00:00.000Z", updatedAt: "2026-09-23T05:00:00.000Z", duplicateOf: [] });
  assert.deepEqual(await getRecipient(db, ORG, r.id), r);
  const full = await createRecipient(db, base({ displayName: "Bob", address: R[1], kycStatus: "verified", taxFlag: "us_1099", settlementPref: "usdc_sol" }));
  assert.deepEqual([full.kycStatus, full.taxFlag, full.settlementPref], ["verified", "us_1099", "usdc_sol"]);
  assert.equal(await getRecipient(db, ORG, "01900000-0000-7000-8000-000000000000"), undefined);
  assert.equal(await getRecipient(db, "other-org", r.id), undefined, "scoped to the org");
});

test("REQ-CON-2: an invalid unified address is rejected, with every problem listed together", async () => {
  assert.deepEqual(await problems(base({ address: MAINNET })), ["address_hrp"], "a valid address of another network");
  assert.deepEqual(await problems(base({ address: R[0].slice(0, -1) + (R[0].endsWith("w") ? "q" : "w") })), ["address_checksum"], "one character changed");
  assert.deepEqual(await problems(base({ address: "uregtest1Qzj498" + R[0].slice(15) })), ["address_case"], "mixed case is not an address");
  assert.deepEqual(await problems(base({ address: "" })), ["address_hrp"]);
  assert.deepEqual(await problems(base({ displayName: "", notes: "x".repeat(1001), address: MAINNET, kycStatus: "maybe" as never, taxFlag: "eu" as never, settlementPref: "btc" as never })).then((c) => c.sort()), ["address_hrp", "kyc_invalid", "name_invalid", "notes_invalid", "settlement_invalid", "tax_invalid"]);
  assert.deepEqual(await problems(base({ displayName: "bad\u0000name" })), ["name_invalid"], "no control characters");
});

test("an all-upper-case address (as QR codes carry it) is the same address, stored lowercase", async () => {
  const r = await createRecipient(db, base({ displayName: "QR", address: R[1].toUpperCase() }));
  assert.equal(r.address, R[1]);
});

test("REQ-CON-2: duplicate addresses are flagged, not blocked (05), on create, list and get", async () => {
  const dir2 = await mkdtemp(join(tmpdir(), "zeceipt-h1-dup-"));
  const db2 = openDb({ path: join(dir2, "c.db") });
  migrateDb(db2);
  try {
    const a = await createRecipient(db2, base({ displayName: "Team wallet (ops)" }));
    const b = await createRecipient(db2, base({ displayName: "Team wallet (grants)" }));
    const c = await createRecipient(db2, base({ displayName: "Carol", address: R[1] }));
    assert.deepEqual(a.duplicateOf, []);
    assert.deepEqual(b.duplicateOf, [a.id], "the second is flagged at once");
    const listed = await listRecipients(db2, ORG);
    assert.deepEqual(listed.map((r) => r.id), [c.id, b.id, a.id], "newest first");
    assert.deepEqual(Object.fromEntries(listed.map((r) => [r.displayName, r.duplicateOf])), { Carol: [], "Team wallet (grants)": [a.id], "Team wallet (ops)": [b.id] });
    assert.deepEqual((await getRecipient(db2, ORG, a.id))!.duplicateOf, [b.id]);
  } finally {
    db2.$client.close();
    await rm(dir2, { recursive: true, force: true });
  }
});

test("the schema refuses raw-SQL garbage on its own (CHECKs)", () => {
  const ins = (over: Record<string, unknown>) => db.$client.prepare(`INSERT INTO recipients (org_id, id, display_name, address, network, kyc_status, tax_flag, settlement_pref, notes, created_at, updated_at) VALUES (@org_id, @id, @display_name, @address, @network, @kyc_status, @tax_flag, @settlement_pref, @notes, 't', 't')`).run({
    org_id: ORG, id: "01900000-0000-7000-8000-00000000000a", display_name: "x", address: R[0], network: "regtest", kyc_status: "unknown", tax_flag: "none", settlement_pref: "zec", notes: "", ...over,
  });
  assert.throws(() => ins({ address: R[0].toUpperCase() }), /recipients_address/, "uppercase stored");
  assert.throws(() => ins({ address: MAINNET }), /recipients_address/, "a mainnet address on a regtest row");
  assert.throws(() => ins({ network: "main", address: R[0] }), /recipients_address/, "a regtest address on a mainnet row");
  assert.throws(() => ins({ kyc_status: "maybe" }), /recipients_kyc/);
  assert.throws(() => ins({ tax_flag: "eu" }), /recipients_tax/);
  assert.throws(() => ins({ settlement_pref: "btc" }), /recipients_settlement/);
  assert.throws(() => ins({ display_name: "" }), /recipients_name_len/);
  assert.throws(() => ins({ notes: "x".repeat(1001) }), /recipients_notes_len/);
  assert.throws(() => ins({ id: "not-a-uuid" }), /recipients_id_uuid/);
});

test("two different addresses with the same Orchard receiver pay the same place: flagged as duplicates (review H1)", async () => {
  const dir3 = await mkdtemp(join(tmpdir(), "zeceipt-h1-rcv-"));
  const db3 = openDb({ path: join(dir3, "c.db") });
  migrateDb(db3);
  try {
    const orchardOnly = ua("uregtest", [item(3, 43, 0x11)]);
    const withSapling = ua("uregtest", [item(2, 43, 0x22), item(3, 43, 0x11)]);
    const other = ua("uregtest", [item(3, 43, 0x33)]);
    assert.notEqual(orchardOnly, withSapling);
    const a = await createRecipient(db3, base({ displayName: "Orchard only", address: orchardOnly }));
    const b = await createRecipient(db3, base({ displayName: "Sapling + Orchard", address: withSapling }));
    const c = await createRecipient(db3, base({ displayName: "Elsewhere", address: other }));
    assert.deepEqual(b.duplicateOf, [a.id], "same Orchard receiver, different string");
    assert.deepEqual(c.duplicateOf, []);
    assert.deepEqual((await getRecipient(db3, ORG, a.id))!.duplicateOf, [b.id]);
  } finally {
    db3.$client.close();
    await rm(dir3, { recursive: true, force: true });
  }
});

test("a display name of only spaces is refused (review H1)", async () => {
  assert.deepEqual(await problems(base({ displayName: "   " })), ["name_invalid"]);
});
