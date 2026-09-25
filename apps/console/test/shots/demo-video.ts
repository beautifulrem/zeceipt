// Demo footage on the live regtest chain (slice L2; the pitch's beats 0:20–1:30, `11_plan.md` §5), re-runnable.
// Opt-in: ZECEIPT_REGTEST=1, with zebrad (RPC 18232), zainod (8137) and zkool_graphql (9000) running as in
// docs/REGTEST_RUNBOOK.md, the issuer in Zkool (account 9) and issuer.key in ARTIFACT_DIR; run after `next build`
// from apps/console: `ZECEIPT_REGTEST=1 node test/shots/demo-video.ts [out-dir]`.
//
// Three segments, each its own browser context and video (playwright's recordVideo), so the minutes spent waiting for
// confirmations are never recorded:
//   1. recipients and five USD bounties → a batch from payables at the locked rate → Approve → Pay;
//   2. the confirmed batch → Issue receipts → the receipts and the History;
//   3. a receipt link opened as its recipient would (VALID: address, amount, memo) → one character of its OCK changed →
//      INVALID at the signature stage.
// Outputs (outside the repository): 1-console.webm, 2-receipts.webm, 3-receipt-page.webm and shots.json (each step's
// offset in its segment, for editing and narration). Receipt links, OCKs and the wrap key stay in memory: shots.json is
// scanned for them before it is written.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP, baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";
import { serveStatic } from "../helpers/static-site.ts";
import { englishChrome } from "../helpers/english-chrome.ts";

if (process.env.ZECEIPT_REGTEST !== "1") {
  console.log("demo footage needs the live regtest chain: set ZECEIPT_REGTEST=1 (docs/REGTEST_RUNBOOK.md)");
  process.exit(0);
}

const ROOT = resolve(APP, "../..");
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? resolve(ROOT, "../raw/tools/regtest");
const ZKOOL = process.env.ZKOOL_URL ?? "http://127.0.0.1:9000/graphql";
const ZAINO = process.env.ENDPOINT ?? "http://127.0.0.1:8137";
const ZEBRA_RPC = process.env.ZEBRA_RPC ?? "http://127.0.0.1:18232/";
const ISSUER = Number(process.env.ZKOOL_ISSUER ?? 9);
// Zkool runs with --jwt-public-key-file (slice S3, REGTEST_RUNBOOK): the console gets the issuer's scoped token; the
// harness, which creates and reads the recipients' accounts, an admin token. Paths only: never printed.
const ZKOOL_TOKEN_FILE = process.env.ZKOOL_TOKEN_FILE ?? join(ARTIFACT_DIR, `zkool-jwt/account-${ISSUER}.jwt`);
const ZKOOL_ADMIN_TOKEN_FILE = process.env.ZKOOL_ADMIN_TOKEN_FILE ?? join(ARTIFACT_DIR, "zkool-jwt/admin.jwt");
const ZKOOL_PUBLIC_KEY_FILE = process.env.ZKOOL_PUBLIC_KEY_FILE ?? join(ARTIFACT_DIR, "zkool-jwt/zkool-jwt.pub");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/release/zeceipt");
const SIZE = { width: 1280, height: 800 };
const HOLD = 1500; // ms after each visible change, so a viewer can read it
const KEY = 3000; // ms on the beats the pitch narrates (approval, payment, VALID, INVALID)

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const OUT = resolve(process.argv[2] ?? join(ROOT, "../raw/demo", stamp));
mkdirSync(OUT, { recursive: true });

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

// Five fresh recipients (Ironwood only), as the regtest e2e makes them.
const PEOPLE = [
  ["Ana Souza", "BOUNTY-101", 45000],
  ["Bo Chen", "BOUNTY-102", 12000],
  ["Chidi Okafor", "BOUNTY-103", 30000],
  ["Dana Kowalski", "BOUNTY-104", 18500],
  ["Eli Haddad", "BOUNTY-105", 22750],
] as const;
const birth = await zebraRpc<number>("getblockcount");
const recipients: { name: string; ua: string; reference: string; usdCents: number }[] = [];
for (const [i, [name, reference, usdCents]] of PEOPLE.entries()) {
  const { createAccount: id } = await zkool<{ createAccount: number }>("mutation($new: NewAccount!) { createAccount(newAccount: $new) }", {
    new: { name: `demo-${stamp}-${i + 1}`, key: "", passphrase: "", aindex: 0, birth, pools: 8, useInternal: false },
  });
  const { addressByAccount } = await zkool<{ addressByAccount: { ua: string } }>("query($id: Int!) { addressByAccount(idAccount: $id) { ua } }", { id });
  recipients.push({ name, ua: addressByAccount.ua, reference, usdCents });
}

const WRAP = randomBytes(32);
const dir = mkdtempSync(join(tmpdir(), "zeceipt-demo-"));
const site = await serveStatic(join(ROOT, "packages/verify"));
const s = await start({
  ...baseEnv(),
  // The rate is Kraken's live ZEC/USD bid, the console's default source (review L2 round 1: a made-up rate must never
  // be shown as Kraken's). Node reaches it through the environment's proxy; local services bypass it.
  NODE_USE_ENV_PROXY: "1", NO_PROXY: "127.0.0.1,localhost",
  ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: ZKOOL, ZECEIPT_ZKOOL_ACCOUNT: String(ISSUER), ZECEIPT_ZKOOL_TOKEN_FILE: ZKOOL_TOKEN_FILE, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: ZKOOL_PUBLIC_KEY_FILE, ZECEIPT_DB_PATH: join(dir, "console.db"),
  ZECEIPT_ORG_ID: "demo", ZECEIPT_NETWORK: "regtest", ZECEIPT_CONFIRMATIONS: "2", ZECEIPT_AUTO_RECEIPTS_SECONDS: "0",
  ZECEIPT_WRAP_KEYS: `k1:${WRAP.toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: ZAINO, ZECEIPT_BIN: BIN,
  ZECEIPT_UFVK_FILE: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), ZECEIPT_ISSUER_KEY_FILE: join(ARTIFACT_DIR, "issuer.key"), ZECEIPT_ISSUER_KEY_ID: "2026-09",
  ZECEIPT_RECEIPT_HOST: site.base,
});
const chrome = await englishChrome();
const browser = chrome.browser;
const shots: { segment: string; file: string; steps: { atMs: number; step: string }[] }[] = [];
const secrets: string[] = [WRAP.toString("base64")];

/** Record one segment: a fresh context whose video is saved as `file` when it closes. */
async function segment(name: string, file: string, body: (page: import("playwright-core").Page, step: (label: string, holdMs?: number) => Promise<void>) => Promise<void>) {
  const vdir = join(OUT, `.${name}`);
  // English UI whatever the machine's locale (review of the first footage: the file picker read in Chinese).
  const context = await browser.newContext({ viewport: SIZE, locale: "en-US", recordVideo: { dir: vdir, size: SIZE } });
  const page = await context.newPage();
  const t0 = Date.now();
  const steps: { atMs: number; step: string }[] = [];
  const step = async (label: string, holdMs = HOLD) => {
    steps.push({ atMs: Date.now() - t0, step: label });
    await page.waitForTimeout(holdMs);
  };
  try {
    await body(page, step);
  } finally {
    await context.close();
  }
  const [video] = readdirSync(vdir).filter((f) => f.endsWith(".webm"));
  renameSync(join(vdir, video), join(OUT, file));
  rmSync(vdir, { recursive: true, force: true });
  shots.push({ segment: name, file, steps });
}

try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const base = `http://${self}`;
  const json = { host: self, origin: base, "content-type": "application/json", "sec-fetch-site": "same-origin" };
  for (const r of recipients) {
    const made = JSON.parse((await raw(s.port, "POST", "/api/recipients", json, JSON.stringify({ displayName: r.name, address: r.ua }))).body) as { id: string };
    const p = await raw(s.port, "POST", "/api/payables", json, JSON.stringify({ recipientId: made.id, kind: "bounty", usdCents: r.usdCents, reference: r.reference }));
    assert.equal(p.status, 201, p.body);
  }

  let batchId = "";
  let lock = { rate: "", source: "", fetchedAt: "" };
  await segment("console", "1-console.webm", async (page, step) => {
    await page.goto(`${base}/recipients`);
    await page.getByText(PEOPLE[4][0]).first().waitFor();
    await step("recipients: five contributors, each with a shielded address");
    await page.goto(`${base}/payables`);
    await page.getByText(PEOPLE[4][1]).first().waitFor();
    await step("payables: five bounties in US dollars");
    await page.goto(`${base}/batches/from-payables`);
    await page.locator('input[name="title"]').fill("September bounties");
    for (const box of await page.locator('input[name="payableIds"]').all()) await box.check();
    await step("choose all five payables for one batch");
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/);
    batchId = page.url().split("/").at(-1)!;
    await page.getByRole("button", { name: /^Approve paying/ }).waitFor();
    lock = (JSON.parse((await raw(s.port, "GET", `/api/batches/${batchId}`, { host: self })).body) as { rateLock: { rate: string; source: string; fetchedAt: string } }).rateLock;
    assert.equal(lock.source, "kraken");
    assert.ok(await page.getByText(`Kraken XZECZUSD`).first().isVisible(), "the page names the source the quote came from");
    await step("the batch: converted at the locked rate (fixed for a batch made from payables); approval comes first");
    await page.getByRole("button", { name: /^Approve paying/ }).click();
    await page.getByRole("button", { name: /^Pay / }).waitFor();
    await step("approved: an HMAC over the lines, the rate and the paying account; Pay appears", KEY);
    await page.getByRole("button", { name: /^Pay / }).click();
    await step("Pay pressed: the wallet builds the shielded transaction (about 25 s on regtest; cut from here to the next shot)", 0);
    await page.getByText("Broadcast, not in a block yet").waitFor({ timeout: 120_000 });
    await step("paid: one Ironwood transaction for all five, broadcast", KEY);
  });

  // Waiting for two confirmations, outside any recording.
  const deadline = Date.now() + 10 * 60_000;
  let state = "";
  while (Date.now() < deadline) {
    state = (JSON.parse((await raw(s.port, "GET", `/api/batches/${batchId}/status`, { host: self })).body) as { state: string }).state;
    if (state === "confirmed") break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  assert.equal(state, "confirmed", `the batch is ${state}`);

  await segment("receipts", "2-receipts.webm", async (page, step) => {
    await page.goto(`${base}/batches/${batchId}`);
    await page.getByRole("button", { name: "Issue receipts" }).waitFor();
    await step("confirmed on chain (2 confirmations): receipts can be issued");
    await page.getByRole("button", { name: "Issue receipts" }).click();
    await page.getByRole("link", { name: "receipt link" }).nth(4).waitFor({ timeout: 180_000 });
    await page.locator("#receipts-heading").scrollIntoViewIfNeeded();
    await step("five receipts, one per payment: each link verifies one output");
    await page.locator("#history-heading").scrollIntoViewIfNeeded();
    await step("the history: created, locked, approved, the attempt, broadcast, the receipts");
  });

  const receipts = (JSON.parse((await raw(s.port, "GET", `/api/batches/${batchId}/receipts`, { host: self })).body) as { receipts: { url: string; receipt: { ock: string } }[] }).receipts;
  assert.equal(receipts.length, 5);
  for (const r of receipts) secrets.push(r.url, r.url.slice(r.url.indexOf("#") + 1), r.receipt.ock);
  const txid = (JSON.parse((await raw(s.port, "GET", `/api/batches/${batchId}/status`, { host: self })).body) as { detail: { txid: string } }).detail.txid;
  const rawFile = join(dir, `${txid}.hex`);
  writeFileSync(rawFile, `${await zebraRpc<string>("getrawtransaction", [txid, 0])}\n`);

  // The same link with one character of its OCK changed (spec §2.1: the fragment is base64url of the receipt JSON).
  const link = receipts[0].url;
  const receipt = JSON.parse(Buffer.from(link.slice(link.indexOf("#") + 1), "base64url").toString("utf8")) as Record<string, unknown>;
  const ock = String(receipt.ock);
  receipt.ock = `${ock.slice(0, -1)}${ock.at(-1) === "0" ? "1" : "0"}`;
  const tampered = `${link.slice(0, link.indexOf("#") + 1)}${Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url")}`;
  secrets.push(tampered);

  await segment("receipt-page", "3-receipt-page.webm", async (page, step) => {
    const open = async (url: string) => {
      await page.goto(url);
      await page.waitForFunction(() => /verification runs in this page/.test(document.getElementById("status")?.textContent ?? ""));
      await page.setInputFiles("#rawfile", rawFile);
      await page.waitForSelector("#outcome:not([hidden])");
    };
    await open(link);
    assert.equal((await page.textContent("#headline"))?.trim(), "VALID");
    await page.locator("#headline").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await step("a recipient opens their link: VALID, with their address, amount and memo recovered from the chain", KEY);
    await page.goto("about:blank");
    await open(tampered);
    assert.equal((await page.textContent("#headline"))?.trim(), "INVALID");
    assert.match((await page.textContent("#stage-copy")) ?? "", /signature/i);
    await page.locator("#headline").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await step("one character of the key changed: INVALID, and the page names the stage (the signature)", KEY);
  });

  const index = {
    version: 1,
    stamp,
    note: "regtest only (a private, consensus-valid chain; PROOF §5). The rate is Kraken's live ZEC/USD bid when the batch was made. No receipt link, OCK or key is in this file.",
    rate: lock,
    batch: { recipients: recipients.length, txid },
    segments: shots,
  };
  const text = JSON.stringify(index, null, 2);
  for (const secret of secrets) assert.ok(!text.includes(secret), "no receipt link, OCK or wrap key in shots.json");
  writeFileSync(join(OUT, "shots.json"), `${text}\n`);
  for (const f of readdirSync(OUT)) console.log(`${f}\t${statSync(join(OUT, f)).size} bytes`);
  console.log(`footage in ${OUT}`);
} finally {
  await chrome.close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  rmSync(dir, { recursive: true, force: true });
  await site.close();
}
