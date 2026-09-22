// End-to-end on the local regtest chain (PROOF §5c). Opt-in: ZECEIPT_REGTEST=1.
// Needs zebrad (RPC 18232), zainod (8137) and zkool_graphql (9000) running as in docs/REGTEST_RUNBOOK.md,
// the issuer restored in Zkool (ZKOOL_ISSUER, default 9), and the issuer signing key in ARTIFACT_DIR.
// Writes a JSON transcript to $ARTIFACT_DIR/console-e2e-<timestamp>.json and prints it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { autoIssue, FileIdempotencyStore, isPreBuildRefusal, POOL, ZkoolBackend, ZkoolClient, ZkoolGraphqlError, type Batch, type TxStatus } from "../lib/index.ts";

const ENABLED = process.env.ZECEIPT_REGTEST === "1";
const ROOT = resolve(import.meta.dirname, "../../..");
// Default: the workspace's sibling artifact directory (outside the repo; holds issuer.key).
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? resolve(ROOT, "../raw/tools/regtest");
const ZKOOL = process.env.ZKOOL_URL ?? "http://127.0.0.1:9000/graphql";
const ZAINO = process.env.ENDPOINT ?? "http://127.0.0.1:8137";
const ZEBRA_RPC = process.env.ZEBRA_RPC ?? "http://127.0.0.1:18232/";
const ISSUER = Number(process.env.ZKOOL_ISSUER ?? 9);
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? 2);

async function zebra<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(ZEBRA_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

test("regtest: 3-recipient batch, one nonce submitted twice → one tx; pending → mined; 3 verified receipts", { skip: !ENABLED && "set ZECEIPT_REGTEST=1", timeout: 20 * 60_000 }, async () => {
  const t0 = Date.now();
  const log: Record<string, unknown>[] = [];
  const step = (name: string, data: Record<string, unknown>) => {
    const e = { step: name, at_ms: Date.now() - t0, ...data };
    log.push(e);
    console.log(JSON.stringify(e, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  };
  const client = new ZkoolClient({ url: ZKOOL });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const storeDir = join(ARTIFACT_DIR, "console-nonces");
  const store = new FileIdempotencyStore(storeDir);
  const backend = new ZkoolBackend({ client, account: ISSUER, store });

  // Fresh recipient accounts (Ironwood only) so each run has its own memos and addresses.
  const recipients: { id: number; ua: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const { createAccount: id } = await client.request<{ createAccount: number }>(
      "mutation($new: NewAccount!) { createAccount(newAccount: $new) }",
      { new: { name: `e2e-${stamp}-${i + 1}`, key: "", passphrase: "", aindex: 0, birth: await client.currentHeight(), pools: 8, useInternal: false } },
    );
    const { addressByAccount } = await client.request<{ addressByAccount: { ua: string } }>("query($id: Int!) { addressByAccount(idAccount: $id) { ua } }", { id });
    recipients.push({ id, ua: addressByAccount.ua });
  }
  const batch: Batch = {
    id: `e2e-${stamp}`,
    network: "regtest",
    items: recipients.map((r, i) => ({ payableId: `p-${i + 1}`, address: r.ua, zat: BigInt(21_000_000 + i * 1_000_000), memo: `INV-C-${stamp}-${i + 1}` })),
  };
  const nonce = `batch-${batch.id}-v1`;

  // The live refusal text for an unaffordable payment must be classified "nothing sent" (retryable).
  try {
    await client.pay(ISSUER, [{ address: recipients[0].ua, zat: 2_000_000_000_000_000n, memo: "refusal-probe" }], POOL.ironwood);
    assert.fail("an unaffordable pay was accepted");
  } catch (e) {
    assert.ok(e instanceof ZkoolGraphqlError, String(e));
    step("refusal probe", { message: e.message, isPreBuildRefusal: isPreBuildRefusal(e) });
    assert.equal(isPreBuildRefusal(e), true);
  }

  const pre = await backend.preflight(batch);
  step("preflight", { ok: pre.ok, problems: pre.problems, totalZat: pre.totalZat, feeEstimateZat: pre.feeEstimateZat, spendableZat: pre.spendableZat, height: pre.height });
  assert.equal(pre.ok, true);

  const heightBefore = await zebra<number>("getblockcount", []);
  const issuerTxsBefore = (await client.transactions(ISSUER, heightBefore)).length;
  const first = await backend.submit(batch, nonce);
  step("submit #1", { ...first });
  const second = await backend.submit(batch, nonce);
  step("submit #2 (same nonce)", { ...second });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.txid, first.txid);

  const seen: string[] = [];
  let st: TxStatus = await backend.status(first.txid);
  step("status", { ...st });
  seen.push(st.state);
  const deadline = Date.now() + 10 * 60_000;
  while (!(st.state === "mined" && st.confirmations >= CONFIRMATIONS) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    st = await backend.status(first.txid);
    step("status", { ...st });
    seen.push(st.state);
  }
  assert.equal(seen[0], "pending", "first status right after broadcast must be pending");
  assert.equal(st.state, "mined");

  // Exactly one new issuer transaction, and the block holds exactly one non-coinbase transaction (ours).
  const issuerTxsAfter = await client.transactions(ISSUER, heightBefore);
  const minedHeight = st.state === "mined" ? st.height : -1;
  const block = await zebra<{ tx: string[] }>("getblock", [String(minedHeight), 1]);
  step("chain check", { issuerTxsNew: issuerTxsAfter.length - issuerTxsBefore, minedHeight, blockTx: block.tx });
  assert.equal(issuerTxsAfter.length - issuerTxsBefore, 1);
  assert.deepEqual(block.tx.slice(1), [first.txid]);
  // The recorded expiry bound really bounds the transaction's consensus expiry height.
  const raw = await zebra<{ expiryheight: number }>("getrawtransaction", [first.txid, 1]);
  const rec = await store.get(nonce);
  step("expiry check", { expiryheight: raw.expiryheight, recordedExpiresBy: rec?.expiresBy, intentHeight: rec?.intentHeight });
  assert.ok(rec?.expiresBy !== undefined && raw.expiryheight <= rec.expiresBy);
  const third = await backend.submit(batch, nonce);
  step("submit #3 after mining (same nonce)", { ...third });
  assert.equal(third.txid, first.txid);

  const outDir = join(ARTIFACT_DIR, `console-receipts-${stamp}`);
  await mkdir(outDir, { recursive: true });
  const issued = await autoIssue({
    batch,
    txid: first.txid,
    status: st,
    requiredConfirmations: CONFIRMATIONS,
    outDir,
    cli: {
      bin: process.env.ZECEIPT_BIN ?? join(ROOT, "target/release/zeceipt"),
      endpoint: ZAINO,
      ufvkFile: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"),
      keyFile: join(ARTIFACT_DIR, "issuer.key"),
      keyId: "2026-09",
      challenge: `auditor-${stamp}`,
    },
  });
  assert.equal(issued.state, "issued");
  if (issued.state !== "issued") return;
  step("autoIssue", {
    receipts: issued.receipts.map((r) => ({ payableId: r.payableId, outputIndex: r.outputIndex, value_zec: r.recovered.value_zec, memo: r.recovered.memo.text, recipient: r.recovered.recipient, is_change: r.recovered.is_change, verified: r.verified })),
    skippedNotInAllowList: issued.skippedNotInAllowList,
    outDir,
  });
  assert.equal(issued.receipts.length, 3);
  assert.equal((await readdir(outDir)).filter((f) => f.endsWith(".json")).length, 3);

  // Recipients' own view: each sees its memo.
  for (const r of recipients) await client.sync(r.id);
  const views = await Promise.all(recipients.map(async (r) => (await client.request<{ transactionsByAccount: { txid: string; notes: { value: string; memo: string }[] }[] }>(
    "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid notes { value memo } } }", { id: r.id })).transactionsByAccount));
  step("recipient views", { views });
  views.forEach((v, i) => assert.equal(v.find((t) => t.txid === first.txid)?.notes[0]?.memo, batch.items[i].memo));

  const file = join(ARTIFACT_DIR, `console-e2e-${stamp}.json`);
  await writeFile(file, JSON.stringify({ batch, nonce, log }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  step("transcript", { file });
});
