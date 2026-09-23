// Payables (slice H3; REQ-CON-3): every field persists; invalid USD or a missing reference is refused, with every
// problem listed; the recipient must be the org's; a reference is unique per org (it becomes the memo), enforced by
// the database; and the schema refuses raw-SQL garbage on its own (cents out of range, a script link).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPayable, createRecipient, getPayable, listPayables, migrateDb, openDb, PayableInvalidError, ReferenceTakenError, USD_CENTS_MAX,
  type ConsoleDb, type PayableInput,
} from "../lib/index.ts";

const ORG = "org-h3";
const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";

let dir: string;
let db: ConsoleDb;
let alice: string;
let otherOrgs: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h3-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
  alice = (await createRecipient(db, { orgId: ORG, network: "regtest", displayName: "Alice", address: UA })).id;
  otherOrgs = (await createRecipient(db, { orgId: "org-other", network: "regtest", displayName: "Mallory", address: UA })).id;
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const base = (over: Partial<PayableInput> = {}): PayableInput => ({ orgId: ORG, recipientId: alice, kind: "invoice", usdCents: 150_00, reference: `INV-${++n}`, ...over });
const problems = async (input: PayableInput) => {
  try {
    await createPayable(db, input);
    return [];
  } catch (e) {
    assert.ok(e instanceof PayableInvalidError, String(e));
    return e.problems.map((p) => `${p.code}@${p.field}`).sort();
  }
};
const count = () => db.$client.prepare("SELECT count(*) FROM payables").pluck().get() as number;

test("REQ-CON-3: a payable created by hand persists every field, with and without a source link", async () => {
  const p = await createPayable(db, base({ kind: "milestone", usdCents: 1_234_56, reference: "Grant #7 — milestone 2 (UI) ✓", sourceUrl: "https://github.com/org/repo/issues/7?x=1#m2" }), { now: () => new Date("2026-09-23T06:00:00.000Z") });
  assert.match(p.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  assert.deepEqual({ ...p, id: undefined }, { id: undefined, recipientId: alice, kind: "milestone", usdCents: 1_234_56, reference: "Grant #7 — milestone 2 (UI) ✓", sourceUrl: "https://github.com/org/repo/issues/7?x=1#m2", createdAt: "2026-09-23T06:00:00.000Z" });
  assert.deepEqual(await getPayable(db, ORG, p.id), p);
  const bare = await createPayable(db, base({ kind: "salary", usdCents: 1, sourceUrl: undefined }));
  assert.equal(bare.sourceUrl, null);
  assert.deepEqual((await getPayable(db, ORG, bare.id))?.usdCents, 1);
  for (const kind of ["bounty", "invoice"] as const) assert.equal((await createPayable(db, base({ kind }))).kind, kind);
  assert.equal((await createPayable(db, base({ usdCents: USD_CENTS_MAX }))).usdCents, 99_999_999, "$999,999.99 is the most");
  assert.equal(await getPayable(db, "org-other", p.id), undefined, "scoped to the org");
});

test("REQ-CON-3: invalid USD is refused: zero, negative, fractional cents, over the cap, not finite", async () => {
  for (const usdCents of [0, -1, 12.5, USD_CENTS_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assert.deepEqual(await problems(base({ usdCents })), ["usd_invalid@usdCents"], String(usdCents));
  }
  assert.equal((await createPayable(db, base({ usdCents: 1e2 }))).usdCents, 100, "1e2 is a whole number");
});

test("REQ-CON-3: a missing or malformed reference is refused, exactly as written (no trimming, NFC)", async () => {
  const bad = ["", "   ", " INV-1", "INV-1 ", "INV\t1", "INV\n1", "x".repeat(101), "\ud800", "Cafe\u0301"];
  for (const reference of bad) assert.deepEqual(await problems(base({ reference })), ["reference_invalid@reference"], JSON.stringify(reference));
  assert.equal((await createPayable(db, base({ reference: "Café-" + "x".repeat(95) }))).reference.length, 100, "100 characters in NFC is allowed");
});

test("review H3: references that look like another are refused (invisible characters, bidirectional controls, other spaces)", async () => {
  const lookalikes = [
    "INV-1\u200b", "INV\u200d-1", "\u2066INV-1\u2069", "INV-1\u00ad", "\u202eINV-1", "INV\u200c-1", "\ufeffINV-1", "INV-1\u061c",
    "INV\u2060-1", "INV-1\ufe0f", "INV\u00a01", "INV\u20031", "INV\u30001", "INV\u20281", "INV\u3164-1",
    // Review H3 round 2: C1 controls (NEL, PAD, CSI) and the braille blank.
    "INV-1\u0085", "INV-\u00801", "INV-1\u009b", "INV\u28001",
  ];
  for (const reference of lookalikes) assert.deepEqual(await problems(base({ reference })), ["reference_invalid@reference"], JSON.stringify(reference));
  for (const reference of ["INV 1 (September)", "Café ☕", "فاتورة-١", "請求書-7", "emoji 🦓", "Grant #7 — milestone 2"]) {
    assert.equal((await createPayable(db, base({ reference }))).reference, reference, `${reference} is allowed`);
  }
  assert.deepEqual(await problems(base({ sourceUrl: "https://example.com/\u202egpj.exe" })), ["source_invalid@sourceUrl"], "a link cannot hide characters either");
  assert.deepEqual(await problems(base({ sourceUrl: "https://example.com/a\u0085b" })), ["source_invalid@sourceUrl"], "nor a C1 control");
});

test("the source link: https or http only, absolute, no credentials, at most 2,000 characters", async () => {
  const bad = ["javascript:alert(1)", "data:text/html,x", "HTTPS://example.com", "https:example.com", "//example.com/x", "/relative", "https://", " https://example.com", "https://exa mple.com", "https://user:pw@example.com/", "https://user@example.com/", `https://example.com/${"a".repeat(1981)}`, "ftp://example.com"];
  for (const sourceUrl of bad) assert.deepEqual(await problems(base({ sourceUrl })), ["source_invalid@sourceUrl"], sourceUrl);
  assert.equal((await createPayable(db, base({ sourceUrl: `https://example.com/${"a".repeat(1980)}` }))).sourceUrl?.length, 2000);
  assert.equal((await createPayable(db, base({ sourceUrl: "http://127.0.0.1:8080/grants/7" }))).sourceUrl, "http://127.0.0.1:8080/grants/7");
});

test("the recipient must be this org's; every problem is listed together; nothing is written", async () => {
  const before = count();
  assert.deepEqual(await problems(base({ recipientId: "01900000-0000-7000-8000-000000000000" })), ["recipient_unknown@recipientId"]);
  assert.deepEqual(await problems(base({ recipientId: otherOrgs })), ["recipient_unknown@recipientId"], "another org's recipient");
  assert.deepEqual(await problems(base({ recipientId: "nope", kind: "gift" as never, usdCents: 0, reference: "", sourceUrl: "javascript:x" })), ["kind_invalid@kind", "recipient_unknown@recipientId", "reference_invalid@reference", "source_invalid@sourceUrl", "usd_invalid@usdCents"]);
  assert.equal(count(), before);
});

test("a reference is unique per org (the memo): 409-style ReferenceTakenError with the holder; other orgs and other case are separate", async () => {
  const first = await createPayable(db, base({ reference: "SEP-001" }));
  const before = count();
  await assert.rejects(createPayable(db, base({ reference: "SEP-001", usdCents: 99 })), (e) => e instanceof ReferenceTakenError && e.code === "reference_taken" && e.payableId === first.id);
  assert.equal(count(), before, "nothing written (the index refused the insert; the holder is read after)");
  const bob = (await createRecipient(db, { orgId: "org-other", network: "regtest", displayName: "Bob", address: UA })).id;
  assert.ok(await createPayable(db, base({ orgId: "org-other", recipientId: bob, reference: "SEP-001" })), "another org may use it");
  assert.ok(await createPayable(db, base({ reference: "sep-001" })), "memos are exact: another case is another reference");
});

test("the schema refuses what the rules refuse, whatever writes it (direct inserts)", () => {
  const insert = (over: Record<string, unknown>) => {
    const v = { org_id: ORG, id: `01900000-0000-7000-8000-${String(++n).padStart(12, "0")}`, recipient_id: alice, kind: "invoice", usd_cents: 100, reference: `RAW-${n}`, source_url: null, created_at: "2026-09-23T06:00:00.000Z", ...over };
    db.$client.prepare("INSERT INTO payables (org_id, id, recipient_id, kind, usd_cents, reference, source_url, created_at) VALUES (@org_id, @id, @recipient_id, @kind, @usd_cents, @reference, @source_url, @created_at)").run(v);
  };
  insert({});
  for (const [over, why] of [
    [{ usd_cents: 0 }, "zero cents"], [{ usd_cents: 100_000_000 }, "over the cap"], [{ usd_cents: 12.5 }, "fractional cents"],
    [{ source_url: "javascript:alert(1)" }, "a script link"], [{ source_url: "https://" }, "no host"], [{ reference: "" }, "empty reference"], [{ reference: " x" }, "leading space"],
    [{ reference: "x".repeat(101) }, "101 characters"], [{ kind: "gift" }, "unknown kind"], [{ recipient_id: "01900000-0000-7000-8000-000000000000" }, "no such recipient (foreign key)"],
    [{ recipient_id: otherOrgs }, "another org's recipient (foreign key)"], [{ created_at: "2026-09-23" }, "not an ISO instant"], [{ id: "not-a-uuid" }, "id"],
  ] as const) assert.throws(() => insert(over), /CHECK constraint failed|FOREIGN KEY constraint failed|datatype mismatch/, why);
  insert({ reference: "RAW-DUP" });
  assert.throws(() => insert({ reference: "RAW-DUP" }), /UNIQUE constraint failed: payables\.org_id, payables\.reference/);
});

test("the list is the org's, newest first", async () => {
  const a = await createPayable(db, base({ reference: "ORDER-A" }));
  const b = await createPayable(db, base({ reference: "ORDER-B" }));
  const list = await listPayables(db, ORG);
  assert.deepEqual(list.slice(0, 2).map((p) => p.id), [b.id, a.id]);
  assert.ok(list.every((p) => p.recipientId === alice));
  assert.ok((await listPayables(db, "org-other")).every((p) => p.recipientId !== alice));
});
