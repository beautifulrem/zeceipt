// The whole product path on the live local regtest chain, through the built console only (PROOF §5d,
// slice E3). Opt-in: ZECEIPT_REGTEST=1, with zebrad (RPC 18232), zainod (8137) and zkool_graphql (9000)
// running as in docs/REGTEST_RUNBOOK.md, the issuer restored in Zkool (account 9), and issuer.key in
// ARTIFACT_DIR (outside the repository).
//
// Like a user without JavaScript: create the draft with the /batches/new form, pay with the batch page's
// form (twice: one payment), watch the derived status reach confirmed, issue with the page's form, list
// the receipts through the API, verify each with the zeceipt CLI against the live chain, and check each
// recipient's own wallet. Then open each receipt link as its recipient would: on the public receipt page
// (packages/verify/r, served by a local static host set as ZECEIPT_RECEIPT_HOST, slice F3) in Chrome, with
// the raw transaction loaded from a file (no public node serves regtest). The transcript holds public facts
// only (no OCK, receipt URL or receipt body).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP, NEXT, baseEnv, children, formFields, multipart, raw, start, waitHealthy, within } from "./helpers/app-server.ts";
import { serveStatic } from "./helpers/static-site.ts";
import { decimalToZat } from "../lib/index.ts";

const ENABLED = process.env.ZECEIPT_REGTEST === "1";
const ROOT = resolve(APP, "../..");
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? resolve(ROOT, "../raw/tools/regtest");
const ZKOOL = process.env.ZKOOL_URL ?? "http://127.0.0.1:9000/graphql";
const ZAINO = process.env.ENDPOINT ?? "http://127.0.0.1:8137";
const ZEBRA_RPC = process.env.ZEBRA_RPC ?? "http://127.0.0.1:18232/";
const ISSUER = Number(process.env.ZKOOL_ISSUER ?? 9);
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/release/zeceipt");

async function zkool<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(ZKOOL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = (await r.json()) as { data: T; errors?: unknown };
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
async function zebraRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(ZEBRA_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await r.json()) as { result: T }).result;
}
const zebraHeight = () => zebraRpc<number>("getblockcount");

before(() => {
  if (!ENABLED) return;
  const b = spawnSync(process.execPath, [NEXT, "build"], { cwd: APP, env: baseEnv() as NodeJS.ProcessEnv, encoding: "utf8", timeout: 300_000 });
  assert.equal(b.status, 0, `next build failed:\n${b.stdout}\n${b.stderr}`);
});
after(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
});

test("regtest through the console: form → pay (twice, one payment) → confirmed → issue → 3 receipts verified on chain → recipients hold their memos", { skip: !ENABLED && "set ZECEIPT_REGTEST=1", timeout: 20 * 60_000 }, async () => {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const log: Record<string, unknown>[] = [];
  const step = (name: string, data: Record<string, unknown> = {}) => {
    const e = { step: name, at_ms: Date.now() - t0, ...data };
    log.push(e);
    console.log(JSON.stringify(e));
  };

  // Fresh recipients (Ironwood only), as in PROOF §5c.
  const birth = await zebraHeight();
  const recipients: { id: number; ua: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const { createAccount: id } = await zkool<{ createAccount: number }>("mutation($new: NewAccount!) { createAccount(newAccount: $new) }", {
      new: { name: `http-${stamp}-${i + 1}`, key: "", passphrase: "", aindex: 0, birth, pools: 8, useInternal: false },
    });
    const { addressByAccount } = await zkool<{ addressByAccount: { ua: string } }>("query($id: Int!) { addressByAccount(idAccount: $id) { ua } }", { id });
    recipients.push({ id, ua: addressByAccount.ua });
  }
  step("recipients", { accounts: recipients.map((r) => r.id), birth });

  // A wrap key made for this run, and a database removed afterwards: the run's receipts (bearer OCKs) never
  // outlive it, sealed or not (review E3 round 1).
  const WRAP = randomBytes(32);
  const dir = mkdtempSync(join(tmpdir(), "zeceipt-regtest-http-"));
  // The public receipt page, hosted locally; the console's links point at it (slice F3).
  const site = await serveStatic(join(ROOT, "packages/verify"));
  const env: Record<string, string> = {
    ...baseEnv(),
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: ZKOOL,
    ZECEIPT_ZKOOL_ACCOUNT: String(ISSUER),
    ZECEIPT_DB_PATH: join(dir, "console.db"),
    ZECEIPT_ORG_ID: "regtest-demo",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_CONFIRMATIONS: "2",
    ZECEIPT_WRAP_KEYS: `k1:${WRAP.toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: ZAINO,
    ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"),
    ZECEIPT_ISSUER_KEY_FILE: join(ARTIFACT_DIR, "issuer.key"),
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
    ZECEIPT_RECEIPT_HOST: site.base,
  };
  const s = await start(env);
  const urls: string[] = [];
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const api = async <T,>(path: string) => JSON.parse((await raw(s.port, "GET", path, { host: self })).body) as T;
    const post = async (path: string, fields: [string, string][]) => {
      const m = multipart(fields);
      return raw(s.port, "POST", path, { ...same, "content-type": m.type }, m.body);
    };

    // 1. Create the draft with the page's form.
    const newPage = (await raw(s.port, "GET", "/batches/new", { host: self })).body;
    const items = recipients.map((r, i) => ({ payableId: `P-${i + 1}`, label: `Recipient ${i + 1}`, address: r.ua, amount: ["0.21", "0.22", "0.23000001"][i], memo: `INV-H-${stamp}-${i + 1}` }));
    const created = await post("/batches/new", [
      ...formFields(newPage, 'name="title"'),
      ["title", `Regtest HTTP ${stamp}`],
      ...items.flatMap((it, n) => (["payableId", "label", "address", "amount", "memo"] as const).map((k) => [`lines.${n}.${k}`, it[k]] as [string, string])),
    ]);
    assert.equal(created.status, 303, created.body.slice(0, 300));
    const id = /^\/batches\/([0-9a-f-]{36})$/.exec(created.location ?? "")![1];
    const batch = await api<{ totalZat: string; items: { zat: string; memo: string }[] }>(`/api/batches/${id}`);
    assert.deepEqual(batch.items.map((i) => i.zat), ["21000000", "22000000", "23000001"]);
    step("created", { batchId: id, totalZat: batch.totalZat, memos: batch.items.map((i) => i.memo) });

    // 2. Pay with the batch page's form; post it again: one payment.
    // The issuer's transactions mined above the pre-pay height (exact, even if other activity came before).
    const heightBeforePay = await zebraHeight();
    // Unmined entries (height 0) count too, so a second payment still waiting to be mined could not hide (review E3 round 2).
    const issuerTxsSince = async (h: number) =>
      (await zkool<{ transactionsByAccount: { txid: string; height: number }[] }>("query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid height } }", { id: ISSUER })).transactionsByAccount.filter((t) => t.height > h || t.height <= 0);
    const draftPage = (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body;
    const payFields = formFields(draftPage, 'name="confirmTotalZat"');
    const paid = await post(`/batches/${id}`, payFields);
    assert.equal(paid.status, 200);
    const afterPay = await api<{ state: string; detail: { txid?: string } }>(`/api/batches/${id}/status`);
    assert.ok(["pending", "confirming", "confirmed"].includes(afterPay.state), `state after pay: ${afterPay.state}`);
    const txid = afterPay.detail.txid!;
    assert.match(txid, /^[0-9a-f]{64}$/);
    step("paid", { txid, state: afterPay.state, height: await zebraHeight() });
    const again = await post(`/batches/${id}`, payFields);
    assert.equal(again.status, 200);
    assert.equal((await api<{ detail: { txid?: string } }>(`/api/batches/${id}/status`)).detail.txid, txid, "the same transaction");

    // 3. Confirmed, by the console's own reader.
    let st: { state: string; detail: { confirmations?: number } } = { state: "", detail: {} };
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      st = await api(`/api/batches/${id}/status`);
      if (st.state === "confirmed") break;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    assert.equal(st.state, "confirmed", `still ${st.state}`);
    const since = await issuerTxsSince(heightBeforePay);
    assert.deepEqual(since.map((t) => t.txid), [txid], "two posts of the pay form made exactly one transaction");
    const mempool = await zebraRpc<string[]>("getrawmempool");
    assert.deepEqual(mempool, [], "and nothing else is waiting to be mined");
    step("confirmed", { confirmations: st.detail.confirmations, height: await zebraHeight(), heightBeforePay, issuerTransactionsSince: since.map((t) => ({ txid: t.txid, height: t.height })), mempool: mempool.length });

    // 4. Issue with the page's form; list through the API.
    const confirmedPage = (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body;
    const issued = await post(`/batches/${id}`, formFields(confirmedPage, "Issue receipts"));
    assert.equal(issued.status, 200);
    const receipts = (await api<{ receipts: { payableId: string; outputIndex: number; valueZat: string; memo: string; url?: string; receipt?: Record<string, unknown> }[] }>(`/api/batches/${id}/receipts`)).receipts;
    assert.equal(receipts.length, 3);
    assert.equal((await api<{ state: string }>(`/api/batches/${id}/status`)).state, "receipts_issued");

    // 5. Verify each receipt's shareable link with the CLI against the live chain (stdin; never a file).
    //    The link carries the payload in its fragment (spec §2.1); only its origin and path are ever printed.
    const verdicts = receipts.map((r) => {
      urls.push(r.url!);
      if (typeof r.receipt?.ock === "string") urls.push(r.receipt.ock); // the raw OCK too, not only the link
      const link = new URL(r.url!);
      assert.ok(link.origin === site.base && link.pathname === "/r" && link.hash.length > 1, `a fragment link on the configured page: ${link.origin}${link.pathname}`);
      const v = spawnSync(BIN, ["verify", "--regtest", "--endpoint", ZAINO, "-", "--require-signature"], { input: r.url, encoding: "utf8", timeout: 120_000 });
      const out = JSON.parse(v.stdout) as { valid: boolean; challenge_checked: boolean; value_zat: number; memo: { text?: string } };
      assert.equal(v.status, 0, v.stderr);
      assert.equal(out.valid, true);
      assert.equal(out.challenge_checked, false, "console receipts carry no challenge");
      return { payableId: r.payableId, outputIndex: r.outputIndex, valueZat: r.valueZat, memo: r.memo, valid: out.valid, recoveredValue: out.value_zat, recoveredMemo: out.memo.text };
    });
    for (const v of verdicts) {
      const it = items.find((i) => i.payableId === v.payableId)!;
      assert.equal(v.recoveredMemo, it.memo);
      assert.equal(String(v.recoveredValue), batch.items[items.indexOf(it)].zat);
    }
    step("receipts", { verdicts });

    // 6. Each recipient's own wallet holds its memo and amount.
    const received = [];
    for (const [i, r] of recipients.entries()) {
      await zkool("mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", { id: r.id });
      const { transactionsByAccount } = await zkool<{ transactionsByAccount: { txid: string; notes: { value: string; memo: string | null }[] }[] }>(
        "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid notes { value memo } } }",
        { id: r.id },
      );
      const note = transactionsByAccount.find((t) => t.txid === txid)?.notes[0];
      assert.equal(note?.memo, items[i].memo, `recipient ${r.id} holds its memo`);
      assert.equal(decimalToZat(note!.value), BigInt(batch.items[i].zat), `recipient ${r.id} holds its exact amount`);
      received.push({ account: r.id, value: note?.value, memo: note?.memo });
    }
    step("recipients_received", { received });

    // 7. Each link, opened as its recipient would: the public page in Chrome, the transaction from a file.
    const rawHex = await zebraRpc<string>("getrawtransaction", [txid, 0]);
    const rawFile = join(dir, `${txid}.hex`);
    writeFileSync(rawFile, `${rawHex}\n`);
    // What must never leave the browser: each receipt's payload (the link's fragment) and its raw OCK.
    const needles = urls.map((x) => (x.includes("#") ? x.slice(x.indexOf("#") + 1) : x));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const pages = [];
    try {
      for (const r of receipts) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const sent: string[] = [];
        page.on("request", (req) => sent.push(`${req.url()} ${JSON.stringify(req.headers())} ${req.postData() ?? ""}`));
        await page.goto(r.url!); // the link exactly as the console printed it: the host redirects /r → /r/, the fragment stays
        assert.equal(new URL(page.url()).pathname, "/r/");
        await page.waitForFunction(() => /verification runs in this page/.test(document.getElementById("status")!.textContent ?? ""));
        await page.setInputFiles("#rawfile", rawFile);
        await page.waitForSelector("#outcome:not([hidden])");
        const shown = async (sel: string) => ((await page.textContent(sel)) ?? "").replace(/\s+/g, " ").trim();
        const headline = await shown("#headline");
        const payment = await shown("#payment");
        const inclusion = await shown("#inclusion");
        const it = items.find((i) => i.payableId === r.payableId)!;
        assert.equal(headline, "VALID", `the page verifies ${r.payableId}`);
        assert.ok(payment.includes(it.memo), `memo of ${r.payableId} on the page`);
        assert.ok(payment.includes(`(${r.valueZat} zat)`), `value of ${r.payableId} on the page`);
        assert.match(inclusion, /^Unknown: the transaction was loaded from a file/);
        assert.match(await shown("#issuer"), /^Signed by key [0-9a-f]{64} \(key id 2026-09\)/);
        assert.ok(sent.every((x) => x.startsWith(site.base)), "a file load makes no outside request");
        assert.ok(!sent.some((x) => needles.some((n) => x.includes(n))), "no request carries a receipt");
        pages.push({ payableId: r.payableId, headline, memoShown: it.memo, valueZatShown: r.valueZat, inclusion: "unknown (file)" });
        await context.close();
      }
    } finally {
      await browser.close();
    }
    assert.ok(!site.seen.some((x) => needles.some((n) => x.url.includes(n) || x.headers.includes(n))), "the page's host never saw a receipt");
    step("page", { host: site.base, requestsToHost: site.seen.length, pages });

    // Nothing secret was written: not the receipt links, not the wrap key.
    const transcript = JSON.stringify({ version: 1, stamp, zkool: ZKOOL, endpoint: ZAINO, issuerAccount: ISSUER, log }, null, 2);
    for (const secret of [...urls, WRAP.toString("base64")]) {
      assert.ok(!transcript.includes(secret) && !s.output().includes(secret), "no receipt link or wrap key in the transcript or server output");
    }
    const file = join(ARTIFACT_DIR, `console-http-e2e-${stamp}.json`);
    writeFileSync(file, transcript + "\n");
    step("transcript", { file });
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    rmSync(dir, { recursive: true, force: true }); // the run's database (sealed receipts) does not outlive it
    await site.close();
  }
});
