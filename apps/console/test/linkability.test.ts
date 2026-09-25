// Linkability (slice H6; REQ-CON-6): real receipts (the fixture regtest transaction, issued by the real CLI as in
// receipts.test.ts) disclose their outputs' addresses; a later line or recipient paying the same Orchard receiver is
// flagged, whatever the UA string; a batch's own receipts and another org's never count; the wording is spec §9's.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  autoIssue, batchDigest, batchNonce, checkUnifiedAddress, createBatch, Keyring, migrateDb, openDb, recordReceipts, SqliteIdempotencyStore, toExecutionBatch,
  type AutoIssueResult, type BatchRecord, type ConsoleDb,
} from "../lib/index.ts";
import { batchLinkability, disclosedReceivers, disclosersOf, indexDisclosures } from "../lib/data/linkability.ts";
import { disclosedText, LINKABILITY_REMEDY, LINKABILITY_SPEC } from "../lib/view/linkability.ts";
import { item, ua } from "./helpers/ua-encoder.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const RAW = join(ROOT, `fixtures/regtest-${TXID}.hex`);
const UFVK = join(ROOT, "fixtures/regtest-issuer-ufvk.txt");
const ORG = "org-h6";
const PAYEES = [
  { payableId: "p-2", label: "R2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: 101_000_000n, memo: "INV-R-002" },
  { payableId: "p-3", label: "R3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: 102_000_000n, memo: "INV-R-003" },
  { payableId: "p-4", label: "R4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: 103_000_000n, memo: "INV-R-004" },
];
const FRESH = ua("uregtest", [item(3, 43, 9)]); // an Orchard receiver no receipt disclosed

let dir: string;
let db: ConsoleDb;
let receipted: BatchRecord;
before(async () => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN}`);
  dir = await mkdtemp(join(tmpdir(), "zeceipt-h6-"));
  db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
  const keyFile = join(dir, "issuer.key");
  execFileSync(BIN, ["keygen", "--out", keyFile]);
  // Batch "September": the fixture transaction's three outputs, broadcast and receipted for real.
  receipted = await createBatch(db, { orgId: ORG, network: "regtest", title: "September", items: PAYEES });
  const store = new SqliteIdempotencyStore(db, { orgId: ORG });
  const base = { nonce: batchNonce(receipted), batchId: receipted.id, batchDigest: batchDigest(toExecutionBatch(receipted)), createdAt: "t", attempts: 1 };
  await store.createIntent({ ...base, state: "submitting" });
  await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
  const out = await autoIssue({ batch: toExecutionBatch(receipted), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, cli: { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile, host: "https://receipts.example", keyId: "2026-09", challenge: "h6" } });
  assert.equal(out.state, "issued");
  await recordReceipts(db, new Keyring([{ kid: "k1", key: Buffer.alloc(32, 0x11) }]), { orgId: ORG, batchId: receipted.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });
});
after(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

test("each receipted output's Orchard receiver is disclosed, by its batch; a later line paying one is flagged, a fresh address is not", async () => {
  const disclosed = await disclosedReceivers(db, ORG);
  assert.equal(disclosed.size, 3);
  for (const p of PAYEES) assert.deepEqual(disclosersOf(disclosed, p.address, "regtest"), [{ batchId: receipted.id, title: "September" }], p.label);
  const later = await createBatch(db, { orgId: ORG, network: "regtest", title: "October", items: [
    { payableId: "o-1", address: FRESH, zat: 5n, memo: "OCT-1" },
    { payableId: "o-2", address: PAYEES[1].address, zat: 5n, memo: "OCT-2" },
  ] });
  assert.deepEqual(batchLinkability(disclosed, later), [{ idx: 1, disclosedBy: [{ batchId: receipted.id, title: "September" }] }]);
});

test("a different UA string with the disclosed Orchard receiver still matches (it pays the same place)", async () => {
  const disclosed = await disclosedReceivers(db, ORG);
  const r = checkUnifiedAddress(PAYEES[0].address, "regtest");
  assert.ok(r.ok);
  const orchard = r.receivers.find((x) => x.typecode === 3)!;
  const other = ua("uregtest", [item(2, 43), [3, 43, ...orchard.data]]);
  assert.notEqual(other, PAYEES[0].address);
  assert.deepEqual(disclosersOf(disclosed, other, "regtest").map((d) => d.title), ["September"]);
});

test("a batch's own receipts never warn about itself; another org's receipts never count", async () => {
  const disclosed = await disclosedReceivers(db, ORG);
  assert.deepEqual(batchLinkability(disclosed, receipted), [], "its own disclosures");
  assert.equal((await disclosedReceivers(db, "org-other")).size, 0);
  assert.deepEqual(disclosersOf(await disclosedReceivers(db, "org-other"), PAYEES[0].address, "regtest"), []);
});

test("a stored recipient that does not decode to an Orchard receiver (Sapling, damaged) is skipped", () => {
  const index = indexDisclosures([
    { recipient: "zregtestsapling1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", batchId: "b1", title: "Sapling", network: "regtest" },
    { recipient: "garbage", batchId: "b2", title: "Damaged", network: "regtest" },
    { recipient: PAYEES[0].address, batchId: "b3", title: "Good", network: "regtest" },
    { recipient: PAYEES[0].address, batchId: "b3", title: "Good", network: "regtest" },
  ]);
  assert.equal(index.size, 1);
  assert.deepEqual([...index.values()][0], [{ batchId: "b3", title: "Good" }], "each batch once");
});

test("REQ-CON-6: the wording is spec §9's, verbatim (read from spec/receipt-v0.md), with the remedy and the batch named", () => {
  const spec = readFileSync(join(ROOT, "spec/receipt-v0.md"), "utf8");
  const section = spec.slice(spec.indexOf("## 9. Privacy notes"), spec.indexOf("## 10."));
  assert.ok(section.includes(`- ${LINKABILITY_SPEC}`), "the first bullet of §9, word for word");
  assert.match(LINKABILITY_REMEDY, /fresh address from the same wallet/);
  assert.equal(disclosedText(["September"]), 'A receipt already disclosed this address (batch "September").');
  assert.equal(disclosedText(["A", "B"]), 'A receipt already disclosed this address (batches "A", "B").');
});
