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
//      INVALID at the signature stage;
//   4. a zecpay CSV imported on the payables page: the preview (new recipients, one matched by Orchard receiver under
//      another name, each row's address, a ZEC row refused by its CSV line), then Import (slice V2c1; the pitch's 1:37 beat);
//   5. the batch page's "Download for OpenZcash (CSV)", downloaded through the page, and the file shown as a table (receipt
//      links and txids abridged on screen);
//   6. a terminal: `zeceipt pack` and `verify-pack` on the batch's five receipts, the verified total a lower bound
//      (slice V2c2; the pitch's 1:14 beat). Both render real outputs; their text is scanned for secrets before it is shown;
//   7. a terminal: keygen, inspect, issue with the issuer's UFVK and verify against the node, each piped to jq so no key
//      is on screen; 8. the hot and external consoles' payment-mode panels; 9. PROOF.md's §5 headings (slice V2e; the
//      technical demo, docs/outreach/tech-demo-video.md).
// Outputs (outside the repository): 1-console.webm to 9-proof.webm and shots.json (each step's
// offset in its segment, for editing and narration). Receipt links, OCKs and the wrap key stay in memory: shots.json is
// scanned for them before it is written.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
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
    await page.getByRole("link", { name: /^Receipt for / }).nth(4).waitFor({ timeout: 180_000 }); // named per payee since slice F
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
  // The first character, not the last: 32 bytes are 43 base64url characters whose last carries two padding bits, so
  // changing a final "0" to "1" made a non-canonical encoding the verifier refuses to parse ("could not be checked"),
  // not a key that fails at the signature (found in slice V2c2: the take depended on the OCK's last character).
  receipt.ock = `${ock[0] === "A" ? "B" : "A"}${ock.slice(1)}`;
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
    // Not "from the chain": no public node serves regtest, so the page loads the transaction from a file (V1's rule).
    await step("a recipient opens their link: VALID, with their address, amount and memo recovered from the transaction (loaded from a file)", KEY);
    await page.goto("about:blank");
    await open(tampered);
    assert.equal((await page.textContent("#headline"))?.trim(), "INVALID");
    assert.match((await page.textContent("#stage-copy")) ?? "", /signature/i);
    await page.locator("#headline").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await step("one character of the key changed: INVALID, and the page names the stage (the signature)", KEY);
  });

  // Two more people for the import, with their own regtest accounts; the CSV also names Ana Souza by her address under a
  // shorter name (matched by Orchard receiver, the existing name kept) and has one ZEC row, which zecpay's format allows
  // and this console refuses (a ZEC amount belongs in a draft batch).
  const more: { name: string; ua: string }[] = [];
  for (const [i, name] of ["Fay Adeyemi", "Gus Lindqvist"].entries()) {
    const { createAccount: id } = await zkool<{ createAccount: number }>("mutation($new: NewAccount!) { createAccount(newAccount: $new) }", {
      new: { name: `demo-${stamp}-import-${i + 1}`, key: "", passphrase: "", aindex: 0, birth, pools: 8, useInternal: false },
    });
    const { addressByAccount } = await zkool<{ addressByAccount: { ua: string } }>("query($id: Int!) { addressByAccount(idAccount: $id) { ua } }", { id });
    more.push({ name, ua: addressByAccount.ua });
  }
  const csv = [
    "name,wallet,amount,currency,payout_currency",
    `${more[0].name},${more[0].ua},350,USD,ZEC`,
    `${more[1].name},${more[1].ua},120.50,USD,ZEC`,
    `Ana,${recipients[0].ua},75,USD,ZEC`,
    `Hal,${more[0].ua},2,ZEC,ZEC`,
  ].join("\n");

  await segment("import", "4-import.webm", async (page, step) => {
    await page.goto(`${base}/payables`);
    await page.getByText("Import payables from a zecpay CSV").click();
    // The payables page has another form with a kind field (adding one payable): scope to the import's form.
    const form = page.locator("form", { has: page.locator('textarea[name="csv"]') });
    await form.locator('textarea[name="csv"]').fill(csv);
    await form.locator('select[name="kind"]').selectOption("milestone");
    await form.locator('input[name="prefix"]').fill("OCT-GRANTS");
    await form.locator('textarea[name="csv"]').scrollIntoViewIfNeeded();
    await step("a zecpay payroll CSV pasted, with the kind and a reference prefix (each reference is the prefix and the CSV line)");
    await form.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import 3 payables$/ }).waitFor();
    assert.ok(await page.getByText("Ana Souza (existing, matched by Orchard receiver").first().isVisible(), "the existing recipient is matched by receiver");
    assert.ok(await page.getByText("CSV line 5 will not be imported: the amount is in ZEC").first().isVisible(), "the ZEC row is refused by its line");
    for (const name of ["Fay Adeyemi (new)", "Gus Lindqvist (new)", "Address it will pay"]) assert.ok(await page.getByText(name).first().isVisible(), `the preview shows ${name} (review V2c1)`);
    // The whole preview on screen: its heading at the top, then the rows and the refusal below it (review of the first
    // take: scrolling only the table's header into view left the rows below the fold).
    await page.getByText(/^Preview: 3 payables to add/).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await step("the preview writes nothing: two new recipients, Ana matched by Orchard receiver under the file's other name, the address each row will pay, and the ZEC row refused by its CSV line", KEY);
    await page.getByRole("button", { name: /^Import 3 payables$/ }).click();
    await page.getByText("Imported 3 payables and 2 new recipients from the zecpay CSV.").waitFor();
    await page.getByText("Imported 3 payables").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await step("imported: three payables and two new recipients, all together", KEY);
    await page.getByText("OCT-GRANTS-2", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await step("the three new payables in the list, each with its reference (OCT-GRANTS-2 to -4, from the CSV lines)", KEY);
  });
  const imported = (JSON.parse((await raw(s.port, "GET", "/api/payables", { host: self })).body) as { payables: { reference: string }[] }).payables.map((p) => p.reference).filter((r) => r.startsWith("OCT-GRANTS-")).sort();
  assert.deepEqual(imported, ["OCT-GRANTS-2", "OCT-GRANTS-3", "OCT-GRANTS-4"]);

  // Segment 5: the OpenZcash download, through the page, and the file as a table. The receipt links and txids are
  // abridged on screen; the scan below proves no whole link reaches the page.
  const show = (html: string) => {
    for (const secret of secrets) assert.ok(!html.includes(secret), "no receipt link, OCK or wrap key on screen");
    return html;
  };
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const shortLink = (u: string) => (u.includes("#") ? `${u.slice(0, u.indexOf("#") + 1)}${u.slice(u.indexOf("#") + 1, u.indexOf("#") + 7)}…` : u);
  let csvRows: string[][] = [];
  await segment("export", "5-export.webm", async (page, step) => {
    await page.goto(`${base}/batches/${batchId}`);
    const offer = page.getByRole("link", { name: "Download for OpenZcash (CSV)" });
    await offer.evaluate((el) => el.closest("div")?.scrollIntoView({ block: "center" }));
    await step("the batch page offers the OpenZcash CSV, saying what the file holds and that it discloses every listed payment, permanently", KEY);
    const [download] = await Promise.all([page.waitForEvent("download"), offer.click()]);
    const file = join(dir, download.suggestedFilename());
    await download.saveAs(file);
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    csvRows = text.split("\r\n").map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
    assert.deepEqual(csvRows[0], ["Recipient", "Detail", "Category", "USD", "ZEC", "Date", "Status", "Txid", "Receipt", "Rate"]);
    assert.equal(csvRows.length, 6, "a header and five rows");
    const cell = (v: string, i: number, row: number) => esc(row === 0 ? v : i === 7 ? `${v.slice(0, 12)}…` : i === 8 ? shortLink(v) : v);
    // A blank document first: setContent on the console's page would keep its CSP, which blocks these inline styles.
    await page.goto("about:blank");
    await page.setContent(show(`<!doctype html><meta charset="utf-8"><title>${esc(download.suggestedFilename())}</title>
      <body style="font:14px system-ui;margin:32px;color:#0f172a"><h1 style="font-size:18px">${esc(download.suggestedFilename())}</h1>
      <p style="color:#475569">The downloaded file, as a spreadsheet shows it: OpenZcash's columns, then the txid, the receipt link and the rate. Links and txids are abridged here, on screen only.</p>
      <table style="border-collapse:collapse">${csvRows.map((r, n) => `<tr>${r.map((v, i) => `<${n ? "td" : "th"} style="border-bottom:1px solid #e2e8f0;padding:6px 10px;text-align:left;${i === 8 ? "font-family:monospace" : ""}">${cell(v, i, n)}</${n ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></body>`));
    await step("the file: one row per payment, in OpenZcash's columns, with each payment's txid, receipt link and rate (links abridged on screen)", KEY);
  });

  // Segment 6: the audit pack, run in a terminal's working directory so the commands shown are the commands run.
  const work = join(dir, "audit");
  mkdirSync(join(work, "receipts"), { recursive: true });
  mkdirSync(join(work, "raw"));
  for (const [i, r] of receipts.entries()) writeFileSync(join(work, "receipts", `receipt-${i + 1}.json`), `${JSON.stringify(r.receipt)}\n`);
  writeFileSync(join(work, "raw", `${txid}.hex`), readFileSync(rawFile, "utf8"));
  const totalZat = (JSON.parse((await raw(s.port, "GET", `/api/batches/${batchId}`, { host: self })).body) as { totalZat: string }).totalZat;
  // The commands shown are run as shown, by sh in the audit directory, with the CLI on PATH (the pack's JSON is long:
  // jq prints one line per receipt, then the totals and the note, from the same report).
  const commands = [
    `zeceipt pack --title "September bounties" --declared-total-zat ${totalZat} receipts/*.json > pack.json`,
    "zeceipt verify-pack pack.json --raw-tx-dir raw --require-signature > report.json",
    "jq -c '.receipts[] | {index, valid, value_zat}' report.json",
    "jq '{all_valid, declared_total_zat, verified_total_zat, note}' report.json",
  ];
  const outputs = commands.map((c) => {
    const r = spawnSync("sh", ["-c", c], { cwd: work, encoding: "utf8", env: { ...process.env, PATH: `${resolve(BIN, "..")}:${process.env.PATH}` } });
    assert.equal(r.status, 0, `${c}: ${r.stderr}`);
    return r.stdout;
  });
  const report = JSON.parse(readFileSync(join(work, "report.json"), "utf8")) as { all_valid: boolean; verified_total_zat: number; receipts: unknown[] };
  assert.equal(report.all_valid, true);
  assert.equal(report.receipts.length, 5);
  assert.equal(String(report.verified_total_zat), totalZat, "the verified total equals the declared one");
  await segment("pack", "6-pack.webm", async (page, step) => {
    // Navigate once before setContent: on a fresh page's first document the recording left the bottom band grey
    // (measured: pixel 127,125,126 without, the page's own colour with).
    await page.goto("data:text/html,");
    await page.setContent(show(`<!doctype html><html style="background:#0b1020"><meta charset="utf-8"><title>terminal</title>
      <body style="margin:0;min-height:100vh;background:#0b1020;color:#e2e8f0;font:14px/1.5 ui-monospace,Menlo,monospace;padding:24px 32px;box-sizing:border-box">
      <div style="color:#94a3b8">~/audit (regtest)</div>
      ${commands.map((c, i) => `<div id="c${i}"><span style="color:#38bdf8">$</span> ${esc(c)}</div><pre style="margin:0 0 6px;white-space:pre-wrap">${esc(outputs[i])}</pre>`).join("")}
      </body>`));
    await page.locator("#c2").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await step("an auditor gets a pack of five receipts instead of a viewing key: verify-pack checks each against the transaction, and all five are valid", KEY);
    await page.locator("#c3").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await step("the verified total equals the declared one, and the report says it is a lower bound", KEY);
  });

  // Segment 7: the technical demo's terminal. A fresh key made here (the issuer's real key file is never copied or shown),
  // the issuer's UFVK file from the fixtures, the live node. Each command runs as shown; jq keeps every OCK off screen.
  const tech = join(dir, "tech");
  mkdirSync(tech);
  const ENDPOINT = ZAINO;
  // In the order they are shown (review V2e): inspect, then keygen, issue and verify.
  const techCommands = [
    `zeceipt inspect --regtest --endpoint ${ENDPOINT} --txid ${txid} | jq -c '{version, outputs: [.outputs[].pool]}'`,
    "zeceipt keygen --out demo.key",
    `zeceipt issue --regtest --endpoint ${ENDPOINT} --txid ${txid} --ufvk-file ufvk.txt --key-file demo.key --out-dir receipts 2>/dev/null | jq -c '.receipts[].recovered | {index, value_zec, memo: .memo.text, is_change}'`,
    `zeceipt verify --regtest --endpoint ${ENDPOINT} --require-signature "$(ls receipts/*.json | head -1)" | jq '{valid, height, value_zec, memo: .memo.text}'`,
  ];
  writeFileSync(join(tech, "ufvk.txt"), readFileSync(join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), "utf8"));
  const techOut = techCommands.map((c) => {
    const r = spawnSync("sh", ["-c", c], { cwd: tech, encoding: "utf8", env: { ...process.env, PATH: `${resolve(BIN, "..")}:${process.env.PATH}` } });
    assert.equal(r.status, 0, `${c}: ${r.stderr}`);
    return r.stdout;
  });
  const inspected = JSON.parse(techOut[0]) as { version: string; outputs: string[] };
  assert.equal(inspected.version, "V6");
  assert.equal(inspected.outputs.length, 6, "six outputs: five payments and the change");
  assert.ok(inspected.outputs.every((p) => p === "ironwood"));
  const issuedLines = techOut[2].trim().split("\n").map((l) => JSON.parse(l) as { is_change: boolean | null });
  assert.equal(issuedLines.length, 5, "five receipts: the change is skipped");
  const checked = JSON.parse(techOut[3]) as { valid: boolean; height: number | null };
  assert.equal(checked.valid, true);
  assert.ok(typeof checked.height === "number" && checked.height > 0, "verified against the node: a mined height");
  for (const f of readdirSync(join(tech, "receipts"))) secrets.push(String((JSON.parse(readFileSync(join(tech, "receipts", f), "utf8")) as { ock: string }).ock));
  const terminal = (lines: { cmd: string; out: string }[]) =>
    show(`<!doctype html><html style="background:#0b1020"><meta charset="utf-8"><title>terminal</title>
      <body style="margin:0;min-height:100vh;background:#0b1020;color:#e2e8f0;font:14px/1.5 ui-monospace,Menlo,monospace;padding:24px 32px;box-sizing:border-box">
      <div style="color:#94a3b8">~/demo (regtest)</div>
      ${lines.map((l, i) => `<div id="c${i}" style="white-space:pre-wrap"><span style="color:#38bdf8">$</span> ${esc(l.cmd)}</div><pre style="margin:0 0 6px;white-space:pre-wrap">${esc(l.out)}</pre>`).join("")}
      </body></html>`);
  // On screen, only the txid is shortened, in the commands only; the outputs are as printed.
  const shown = (c: string) => c.replaceAll(txid, `${txid.slice(0, 10)}…`);
  await segment("tech-terminal", "7-tech-terminal.webm", async (page, step) => {
    await page.goto("data:text/html,");
    await page.setContent(terminal([{ cmd: shown(techCommands[0]), out: techOut[0] }]));
    await step("inspect: the batch's transaction is version 6, with six Ironwood outputs (five payments and the change)", KEY);
    await page.setContent(terminal([{ cmd: shown(techCommands[0]), out: techOut[0] }, { cmd: techCommands[1], out: techOut[1] }, { cmd: shown(techCommands[2]), out: techOut[2] }]));
    await step("issue with the issuer's full viewing key: one receipt per payment, five, the change skipped; recipient, amount and memo recovered, no key shown", KEY);
    await page.setContent(terminal([{ cmd: shown(techCommands[2]), out: techOut[2] }, { cmd: shown(techCommands[3]), out: techOut[3] }]));
    await step("verify one receipt against the node: valid, and the height of the block it was mined in", KEY);
  });

  // Segment 8: the two custody modes, as each console's home page states them.
  const ext = await start({
    ...baseEnv(),
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "external.db"), ZECEIPT_ORG_ID: "demo-external", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${WRAP.toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: ZAINO, ZECEIPT_BIN: BIN,
    ZECEIPT_UFVK_FILE: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), ZECEIPT_RECEIPT_HOST: site.base,
    // The demo key made in segment 7 (the issuer's real key file is never used for this second console).
    ZECEIPT_ISSUER_KEY_FILE: join(tech, "demo.key"), ZECEIPT_ISSUER_KEY_ID: "2026-09",
  });
  try {
    await waitHealthy(ext.port, ext.child, ext.output);
    await segment("custody", "8-custody.webm", async (page, step) => {
      // A blank page first, and a moment for the recording to start: the first take had no frame of the hot console,
      // which painted before the recorder's first frame and never changed.
      await page.goto("data:text/html,");
      await page.waitForTimeout(500);
      await page.goto(`${base}/`);
      await page.getByText("Hot wallet: the seed lives only in Zkool").first().waitFor();
      await page.getByText("Hot wallet: the seed lives only in Zkool").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await step("hot custody: the console pays through Zkool, and the seed lives only in the wallet", KEY);
      await page.goto(`http://127.0.0.1:${ext.port}/`);
      await page.getByText("External signer: this console never pays or tracks payments").first().waitFor();
      await page.getByText("External signer: this console never pays or tracks payments").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await step("external custody: a second console holding the viewing key only, which never pays", KEY);
    });
    const refused = await raw(ext.port, "POST", "/api/batches/00000000-0000-7000-8000-000000000000/submit", { host: `127.0.0.1:${ext.port}`, origin: `http://127.0.0.1:${ext.port}`, "content-type": "application/json", "sec-fetch-site": "same-origin" }, JSON.stringify({ confirmTotalZat: "1" }));
    assert.equal(refused.status, 409, `the external console refuses to pay: ${refused.body}`);
    assert.match(refused.body, /custody_external/);
  } finally {
    ext.child.kill("SIGTERM");
    await within(ext.exited, 10_000, "shutdown").catch(() => ext.child.kill("SIGKILL"));
  }

  // Segment 9: the proof document's regtest sections, its own headings.
  const proofHeadings = readFileSync(join(ROOT, "docs/PROOF.md"), "utf8").split("\n").filter((l) => /^## 5/.test(l)).map((l) => l.slice(3));
  assert.ok(proofHeadings.length >= 7, "PROOF §5 to §5g");
  await segment("proof", "9-proof.webm", async (page, step) => {
    await page.goto("data:text/html,");
    await page.setContent(show(`<!doctype html><html><meta charset="utf-8"><title>docs/PROOF.md</title>
      <body style="font:16px/1.6 system-ui;margin:40px 56px;color:#0f172a"><div style="color:#64748b;font:13px ui-monospace,Menlo,monospace">docs/PROOF.md (its regtest sections)</div>
      <ul style="padding-left:20px">${proofHeadings.map((h) => `<li style="margin:6px 0">${esc(h)}</li>`).join("")}</ul></body></html>`));
    await step("the proof document: each regtest run with its transcript (PROOF §5 to §5g)", KEY);
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
