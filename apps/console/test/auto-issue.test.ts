// autoIssue against the real `zeceipt` binary, offline, on the committed Zkool batch fixture
// (fixtures/regtest-48db254a…: 3 recipients with memos INV-R-002..004 + change, PROOF §5b).
// ZECEIPT_BIN defaults to the workspace debug build (CI builds it in the same job).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { autoIssue, IssuanceMismatchError, type Batch, type IssuedReceipt, type TxStatus } from "../lib/index.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt");
const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
const RAW = join(ROOT, `fixtures/regtest-${TXID}.hex`);
const UFVK = join(ROOT, "fixtures/regtest-issuer-ufvk.txt");

const batch: Batch = {
  id: "fixture-batch",
  network: "regtest",
  items: [
    { payableId: "p-2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: 101_000_000n, memo: "INV-R-002" },
    { payableId: "p-3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: 102_000_000n, memo: "INV-R-003" },
    { payableId: "p-4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: 103_000_000n, memo: "INV-R-004" },
  ],
};
const mined = (confirmations: number): TxStatus => ({ state: "mined", height: 626, confirmations, tip: 625 + confirmations });

let dir: string;
let cli: Parameters<typeof autoIssue>[0]["cli"];
before(async () => {
  assert.ok(existsSync(BIN), `zeceipt binary not found at ${BIN} (cargo build -p zeceipt-cli, or set ZECEIPT_BIN)`);
  dir = await mkdtemp(join(tmpdir(), "zeceipt-autoissue-"));
  execFileSync(BIN, ["keygen", "--out", join(dir, "issuer.key")]);
  cli = { bin: BIN, rawTxFile: RAW, ufvkFile: UFVK, keyFile: join(dir, "issuer.key"), keyId: "2026-09", challenge: "console-test-nonce" };
});
after(async () => rm(dir, { recursive: true, force: true }));

test("waits below the confirmation threshold and while not mined", async () => {
  assert.deepEqual(await autoIssue({ batch, txid: TXID, status: mined(1), requiredConfirmations: 3, cli }), { state: "waiting", confirmations: 1, required: 3 });
  assert.deepEqual(await autoIssue({ batch, txid: TXID, status: { state: "pending", broadcastAt: "x" }, requiredConfirmations: 1, cli }), { state: "waiting", confirmations: 0, required: 1 });
});

test("issues exactly one verified receipt per batch item; change and non-batch outputs never", async () => {
  const outDir = join(dir, "out");
  const r = await autoIssue({ batch, txid: TXID, status: mined(3), requiredConfirmations: 3, cli, outDir });
  assert.equal(r.state, "issued");
  if (r.state !== "issued") return;
  assert.equal(r.receipts.length, 3);
  assert.equal(r.skippedNotInAllowList, 0); // change is already excluded by ownership; nothing else to skip
  for (const item of batch.items) {
    const got: IssuedReceipt = r.receipts.find((x) => x.payableId === item.payableId)!;
    assert.equal(got.recovered.memo.text, item.memo);
    assert.equal(BigInt(got.recovered.value_zat), item.zat);
    assert.equal(got.recovered.is_change, false);
    assert.equal(got.verified, true);
    assert.equal(got.receipt.txid, TXID);
    assert.equal(got.receipt.challenge, Buffer.from("console-test-nonce").toString("base64url"));
  }
  assert.equal((await readdir(outDir)).length, 3);
});

test("links are <host>/r#<payload> on the configured receipt page (slice F3); without a host, the CLI's default", async () => {
  const one: Batch = { ...batch, items: [batch.items[0]] };
  const withHost = await autoIssue({ batch: one, txid: TXID, status: mined(1), requiredConfirmations: 1, cli: { ...cli, host: "https://user.github.io/zeceipt" } });
  assert.equal(withHost.state, "issued");
  if (withHost.state !== "issued") return;
  const link = new URL(withHost.receipts[0].url);
  assert.equal(`${link.origin}${link.pathname}`, "https://user.github.io/zeceipt/r");
  assert.deepEqual(JSON.parse(Buffer.from(link.hash.slice(1), "base64url").toString("utf8")), withHost.receipts[0].receipt, "the fragment is the receipt");
  const byDefault = await autoIssue({ batch: one, txid: TXID, status: mined(1), requiredConfirmations: 1, cli });
  assert.equal(byDefault.state === "issued" && new URL(byDefault.receipts[0].url).origin, "https://zeceipt.xyz");
});

test("a batch naming only some recipients gets receipts for those only (allow-list)", async () => {
  const partial: Batch = { ...batch, items: [batch.items[1]] };
  const r = await autoIssue({ batch: partial, txid: TXID, status: mined(1), requiredConfirmations: 1, cli });
  assert.equal(r.state, "issued");
  if (r.state === "issued") {
    assert.deepEqual(r.receipts.map((x) => x.recovered.memo.text), ["INV-R-003"]);
    assert.equal(r.skippedNotInAllowList, 2);
  }
});

test("fails closed on value or memo mismatch: returns nothing and writes no file", async () => {
  const wrongValue: Batch = { ...batch, items: batch.items.map((i, k) => (k === 0 ? { ...i, zat: i.zat + 1n } : i)) };
  const outDir = join(dir, "must-stay-empty");
  await mkdir(outDir);
  await assert.rejects(autoIssue({ batch: wrongValue, txid: TXID, status: mined(1), requiredConfirmations: 1, cli, outDir }), (e: unknown) => e instanceof IssuanceMismatchError && /value 1\.01000000/.test((e as Error).message));
  assert.deepEqual(await readdir(outDir), []);
  const wrongMemo: Batch = { ...batch, items: batch.items.map((i, k) => (k === 2 ? { ...i, memo: "INV-R-999" } : i)) };
  await assert.rejects(autoIssue({ batch: wrongMemo, txid: TXID, status: mined(1), requiredConfirmations: 1, cli }), IssuanceMismatchError);
});

test("an address that is not a payee of the transaction yields a mismatch, not a receipt", async () => {
  const foreign: Batch = { ...batch, items: [{ ...batch.items[0], address: "uregtest1rqwdd05yxqf4807jcddv556x6pq2xqnqtyt6hsv3gzg6wnayrqthv7fw0fuvplrzxsjq2fzpnzmltndrpzulpvs7k25wyn5cfvsu294d" }] };
  await assert.rejects(autoIssue({ batch: foreign, txid: TXID, status: mined(1), requiredConfirmations: 1, cli }), IssuanceMismatchError);
});

test("each receipt must pay its own item's address: swapped payees are a mismatch", async () => {
  const [a, b2, c] = batch.items;
  const swapped: Batch = { ...batch, items: [{ ...a, address: b2.address }, { ...b2, address: a.address }, c] };
  await assert.rejects(
    autoIssue({ batch: swapped, txid: TXID, status: mined(1), requiredConfirmations: 1, cli }),
    (e: unknown) => e instanceof IssuanceMismatchError && /payable p-2: output ironwood:\d+ pays .* not this payable's address/.test((e as Error).message),
  );
});

test("a batch that could claim one output twice is refused before anything runs", async () => {
  const twice: Batch = { ...batch, items: [batch.items[1], { ...batch.items[1], payableId: "p-3-dup" }] };
  await assert.rejects(autoIssue({ batch: twice, txid: TXID, status: mined(1), requiredConfirmations: 1, cli }), (e: unknown) => e instanceof IssuanceMismatchError && /appears twice/.test((e as Error).message));
  const noMemo: Batch = { ...batch, items: [{ ...batch.items[0], memo: "" }] };
  await assert.rejects(autoIssue({ batch: noMemo, txid: TXID, status: mined(1), requiredConfirmations: 1, cli }), /empty memo/);
});

test("without a challenge (console receipts, slice D3): none is bound, and a receipt that carries one does not verify without it", async () => {
  const noChallenge = { ...cli, challenge: undefined };
  const r = await autoIssue({ batch, txid: TXID, status: mined(3), requiredConfirmations: 3, cli: noChallenge });
  assert.equal(r.state, "issued");
  if (r.state !== "issued") return;
  for (const got of r.receipts) assert.equal("challenge" in got.receipt, false);
  // Fail closed: a receipt issued with a challenge is refused by a verifier that expects none.
  const withChallenge = await autoIssue({ batch, txid: TXID, status: mined(3), requiredConfirmations: 3, cli });
  assert.equal(withChallenge.state, "issued");
  if (withChallenge.state !== "issued") return;
  const v = spawnSync(BIN, ["verify", "--regtest", "--raw-tx-file", RAW, "-", "--require-signature"], { input: JSON.stringify(withChallenge.receipts[0].receipt), encoding: "utf8" });
  assert.notEqual(v.status, 0, "verification without the bound challenge must fail");
  assert.match(`${v.stdout}${v.stderr}`, /challenge/i, "and fail at the challenge stage");
});
