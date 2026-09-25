// The payables path on the live local regtest chain, through the built console (slice P2, PROOF §5g). Opt-in:
// ZECEIPT_REGTEST=1, the regtest services as in docs/REGTEST_RUNBOOK.md (Zkool with --jwt-public-key-file), and
// Kraken reachable (NODE_USE_ENV_PROXY=1 behind a proxy): the rate is Kraken's live ZEC/USD bid, never a fake.
//
// What §5d does not show, shown here: recipients and USD payables made through the API, a batch made from the
// payables at Kraken's live rate (fixed at creation), approval, one payment, and receipts issued by the receipt
// worker on its own (ZECEIPT_AUTO_RECEIPTS_SECONDS) — nobody presses Issue. Each receipt is verified with the CLI
// against the chain, and each recipient's wallet holds its reference as the memo. Public facts only in the transcript.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP, NEXT, baseEnv, raw, start, waitHealthy, within } from "./helpers/app-server.ts";
import { decimalToZat } from "../lib/index.ts";

const ENABLED = process.env.ZECEIPT_REGTEST === "1";
const ROOT = resolve(APP, "../..");
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? resolve(ROOT, "../raw/tools/regtest");
const ZKOOL = process.env.ZKOOL_URL ?? "http://127.0.0.1:9000/graphql";
const ZAINO = process.env.ENDPOINT ?? "http://127.0.0.1:8137";
const ZEBRA_RPC = process.env.ZEBRA_RPC ?? "http://127.0.0.1:18232/";
const ISSUER = Number(process.env.ZKOOL_ISSUER ?? 9);
// Paths only: never printed (slice S3).
const ZKOOL_TOKEN_FILE = process.env.ZKOOL_TOKEN_FILE ?? join(ARTIFACT_DIR, `zkool-jwt/account-${ISSUER}.jwt`);
const ZKOOL_ADMIN_TOKEN_FILE = process.env.ZKOOL_ADMIN_TOKEN_FILE ?? join(ARTIFACT_DIR, "zkool-jwt/admin.jwt");
const ZKOOL_PUBLIC_KEY_FILE = process.env.ZKOOL_PUBLIC_KEY_FILE ?? join(ARTIFACT_DIR, "zkool-jwt/zkool-jwt.pub");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/release/zeceipt");

async function zkool<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${readFileSync(ZKOOL_ADMIN_TOKEN_FILE, "utf8").trim()}` };
  const r = await fetch(ZKOOL, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  const j = (await r.json()) as { data: T; errors?: unknown };
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
async function zebraRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(ZEBRA_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await r.json()) as { result: T }).result;
}

before(() => {
  if (!ENABLED) return;
  const b = spawnSync(process.execPath, [NEXT, "build"], { cwd: APP, env: baseEnv() as NodeJS.ProcessEnv, encoding: "utf8", timeout: 300_000 });
  assert.equal(b.status, 0, `next build failed:\n${b.stdout}\n${b.stderr}`);
});

test("regtest, payables to receipts: USD payables → batch at Kraken's live rate → approve → pay once → the worker issues 3 receipts on its own → verified on chain → recipients hold their references", { skip: !ENABLED && "set ZECEIPT_REGTEST=1", timeout: 20 * 60_000 }, async () => {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const log: Record<string, unknown>[] = [];
  const step = (name: string, data: Record<string, unknown> = {}) => {
    const e = { step: name, at_ms: Date.now() - t0, ...data };
    log.push(e);
    console.log(JSON.stringify(e));
  };

  // Fresh recipient accounts; the first holds Sapling and Ironwood receivers (pools 10), as most wallets' addresses do.
  const birth = await zebraRpc<number>("getblockcount");
  const accounts: { id: number; ua: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const { createAccount: id } = await zkool<{ createAccount: number }>("mutation($new: NewAccount!) { createAccount(newAccount: $new) }", {
      new: { name: `payables-${stamp}-${i + 1}`, key: "", passphrase: "", aindex: 0, birth, pools: i === 0 ? 10 : 8, useInternal: false },
    });
    const { addressByAccount } = await zkool<{ addressByAccount: { ua: string } }>("query($id: Int!) { addressByAccount(idAccount: $id) { ua } }", { id });
    accounts.push({ id, ua: addressByAccount.ua });
  }
  step("accounts", { accounts: accounts.map((a) => a.id), birth });

  const WRAP = randomBytes(32);
  const dir = mkdtempSync(join(tmpdir(), "zeceipt-regtest-payables-"));
  const env: Record<string, string> = {
    ...baseEnv(),
    NODE_USE_ENV_PROXY: "1", NO_PROXY: "127.0.0.1,localhost", // Kraken through the machine's proxy; loopback direct
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: ZKOOL,
    ZECEIPT_ZKOOL_ACCOUNT: String(ISSUER), ZECEIPT_ZKOOL_TOKEN_FILE: ZKOOL_TOKEN_FILE, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: ZKOOL_PUBLIC_KEY_FILE,
    ZECEIPT_DB_PATH: join(dir, "console.db"),
    ZECEIPT_ORG_ID: "regtest-payables",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "2",
    ZECEIPT_AUTO_RECEIPTS_SECONDS: "2", // the receipt worker issues on its own once the batch has 2 confirmations
    ZECEIPT_WRAP_KEYS: `k1:${WRAP.toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: ZAINO,
    ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"),
    ZECEIPT_ISSUER_KEY_FILE: join(ARTIFACT_DIR, "issuer.key"),
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
    ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    // ZECEIPT_RATE_URL unset: Kraken's own Ticker, the console's default.
  };
  const s = await start(env);
  const secrets: string[] = [WRAP.toString("base64")];
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const json = { host: self, origin: `http://${self}`, "content-type": "application/json" };
    const post = async <T,>(path: string, body: unknown, status = 201) => {
      const r = await raw(s.port, "POST", path, json, JSON.stringify(body));
      assert.equal(r.status, status, `${path}: ${r.body.slice(0, 300)}`);
      return JSON.parse(r.body) as T;
    };
    const get = async <T,>(path: string) => JSON.parse((await raw(s.port, "GET", path, { host: self })).body) as T;

    // 1. Recipients and USD payables, through the API.
    const cents = [2_500, 3_300, 4_150];
    const refs = cents.map((_, i) => `PAY-${stamp}-${i + 1}`);
    const payableIds: string[] = [];
    for (const [i, a] of accounts.entries()) {
      const r = await post<{ id: string }>("/api/recipients", { displayName: `Contributor ${i + 1}`, address: a.ua });
      payableIds.push((await post<{ id: string }>("/api/payables", { recipientId: r.id, kind: "bounty", usdCents: cents[i], reference: refs[i] })).id);
    }
    step("payables", { usdCents: cents, references: refs });

    // 2. A batch from the payables: its rate is locked at creation from Kraken, and fixed.
    const batch = await post<{ id: string; totalZat: string; items: { zat: string; memo: string; usdCents: number }[]; rateLock: { rate: string; host: string | null; source: string; fetchedAt: string }; rateFixed: boolean }>(
      "/api/batches/from-payables", { title: `Payables ${stamp}`, payableIds },
    );
    assert.equal(batch.rateLock.host, "api.kraken.com", "the rate is Kraken's own, not a proxy or a double");
    assert.equal(batch.rateFixed, true);
    assert.deepEqual(batch.items.map((i) => i.memo), refs, "each line carries its payable's reference as the memo");
    // Each line is its USD converted at the lock, floored to the zatoshi so the payer never overpays (lib/rates/convert.ts):
    // recomputed here from the lock's rate.
    const [whole, frac = ""] = batch.rateLock.rate.split(".");
    const rateMicros = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6));
    for (const [i, it] of batch.items.entries()) {
      const floor = (BigInt(cents[i]) * 1_000_000n * 100_000_000n) / (100n * rateMicros);
      assert.equal(BigInt(it.zat), floor, `line ${i + 1}: ${it.zat} zat for ${cents[i]} cents at ${batch.rateLock.rate}`);
    }
    const page = (await raw(s.port, "GET", `/batches/${batch.id}`, { host: self })).body.replaceAll("<!-- -->", "");
    assert.ok(page.includes("Kraken") && !page.includes("Kraken-format quote from"), "the page names Kraken, the source it is");
    step("batch", { rate: batch.rateLock.rate, source: batch.rateLock.source, host: batch.rateLock.host, fetchedAt: batch.rateLock.fetchedAt, zat: batch.items.map((i) => i.zat), totalZat: batch.totalZat });

    // 3. Approve (the total and the lock), then pay once; a second submit replays it.
    await post("/api/batches/" + batch.id + "/approve", { confirmTotalZat: batch.totalZat, lockSeq: 1 });
    const heightBeforePay = await zebraRpc<number>("getblockcount");
    const paid = await post<{ txid: string; replayed: boolean; via: string }>(`/api/batches/${batch.id}/submit`, { confirmTotalZat: batch.totalZat }, 202);
    assert.deepEqual([paid.replayed, paid.via], [false, "fresh"]);
    const again = await post<{ txid: string; replayed: boolean }>(`/api/batches/${batch.id}/submit`, { confirmTotalZat: batch.totalZat }, 202);
    assert.deepEqual([again.txid, again.replayed], [paid.txid, true]);
    step("paid", { txid: paid.txid, height: await zebraRpc<number>("getblockcount") });

    // 4. Nobody presses Issue: the worker issues once the batch has its confirmations.
    let receipts: { payableId: string; outputIndex: number; valueZat: string; memo: string; url?: string; receipt?: Record<string, unknown> }[] = [];
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      receipts = (await get<{ receipts: typeof receipts }>(`/api/batches/${batch.id}/receipts`)).receipts;
      if (receipts.length === 3) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    assert.equal(receipts.length, 3, `the worker did not issue: ${s.output().slice(-600)}`);
    assert.match(s.output(), new RegExp(`receipts: issued for batch ${batch.id}`), "the worker's own log line");
    const status = await get<{ state: string }>(`/api/batches/${batch.id}/status`);
    assert.equal(status.state, "receipts_issued");
    const history = (await get<{ events: { action: string }[] }>(`/api/batches/${batch.id}/history`)).events.map((e) => e.action);
    assert.equal(history.filter((a) => a === "receipt_issued").length, 3);
    const issuerTxs = (await zkool<{ transactionsByAccount: { txid: string; height: number }[] }>("query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid height } }", { id: ISSUER })).transactionsByAccount.filter((t) => t.height > heightBeforePay || t.height <= 0);
    assert.deepEqual(issuerTxs.map((t) => t.txid), [paid.txid], "exactly one transaction");
    step("receipts_by_worker", { count: receipts.length, workerLine: true, history, confirmedHeight: issuerTxs[0].height });

    // 5. Each receipt verified with the CLI against the chain (stdin), and each recipient's wallet holds its reference.
    const verdicts = [];
    for (const r of receipts) {
      secrets.push(r.url!);
      if (typeof r.receipt?.ock === "string") secrets.push(r.receipt.ock);
      const v = spawnSync(BIN, ["verify", "--regtest", "--endpoint", ZAINO, "-", "--require-signature"], { input: r.url, encoding: "utf8", timeout: 120_000 });
      assert.equal(v.status, 0, v.stderr);
      const out = JSON.parse(v.stdout) as { valid: boolean; value_zat: number; memo: { text?: string } };
      const line = batch.items.find((i) => i.memo === r.memo)!;
      assert.deepEqual([out.valid, String(out.value_zat), out.memo.text], [true, line.zat, line.memo]);
      verdicts.push({ memo: r.memo, valueZat: r.valueZat, valid: out.valid });
    }
    step("verified", { verdicts });
    const received = [];
    for (const [i, a] of accounts.entries()) {
      await zkool("mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", { id: a.id });
      const { transactionsByAccount } = await zkool<{ transactionsByAccount: { txid: string; notes: { value: string; memo: string | null }[] }[] }>(
        "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid notes { value memo } } }",
        { id: a.id },
      );
      const note = transactionsByAccount.find((t) => t.txid === paid.txid)?.notes[0];
      assert.equal(note?.memo, refs[i], `account ${a.id} holds its reference`);
      assert.equal(decimalToZat(note!.value), BigInt(batch.items[i].zat));
      received.push({ account: a.id, value: note!.value, memo: note!.memo });
    }
    step("recipients_received", { received });

    const transcript = JSON.stringify({ version: 1, stamp, zkool: ZKOOL, endpoint: ZAINO, issuerAccount: ISSUER, log }, null, 2);
    for (const secret of secrets) assert.ok(!transcript.includes(secret) && !s.output().includes(secret), "no receipt link, OCK or wrap key in the transcript or server output");
    const file = join(ARTIFACT_DIR, `console-payables-e2e-${stamp}.json`);
    writeFileSync(file, transcript + "\n");
    step("transcript", { file });
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    rmSync(dir, { recursive: true, force: true }); // the run's database (sealed receipts) does not outlive it
  }
});
