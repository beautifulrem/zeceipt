// Chrome e2e for the dossier pages: the case review page (case/), the dossier builder (build/) and the landing page
// (index.html). Opt-in: ZECEIPT_BROWSER_E2E=1. Drives the installed Google Chrome through playwright-core, as
// page.e2e.mjs does: a tiny static host serves packages/verify, and the public testnet gRPC-web node is intercepted and
// serves the real testnet transactions in fixtures/testnet/ (the sample dossier's), so no internet is needed. Every
// request is recorded, to prove that neither the dossier nor the holder's viewing key ever leaves the browser.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const RUN = process.env.ZECEIPT_BROWSER_E2E === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const repo = path.join(root, "..", "..");
const read = (p) => fs.readFileSync(p, "utf8");
const b64 = (s) => Buffer.from(s).toString("base64url");

const SAMPLE = read(path.join(repo, "fixtures/dossier/testnet-dossier.json"));
const DOSSIER = JSON.parse(SAMPLE);
const UFVK = read(path.join(repo, "fixtures/testnet/issuer-ufvk.txt")).trim();
const FUNDS = ["90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b", "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b", "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d", "a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8"];
const CONTROL = "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43";
const NONCE = DOSSIER.claims[11].nonce;
// The heights the testnet node reported for these transactions (checked live on 2026-09-30).
const HEIGHTS = { [FUNDS[0]]: 4419987, [FUNDS[1]]: 4420000, [FUNDS[2]]: 4420003, [FUNDS[3]]: 4420005, [CONTROL]: 4421345 };
const ZDP_TEST = JSON.parse(read(path.join(repo, "fixtures/zdp/testnet.json"))); // a testnet payment the issuer's key does not see
const CHAIN = Object.fromEntries([...FUNDS, CONTROL].map((t) => [t, read(path.join(repo, "fixtures/testnet", `${t}.hex`)).trim()]));
CHAIN[ZDP_TEST.txid] = ZDP_TEST.txHex;
const TAMPERED = JSON.stringify({ ...DOSSIER, claims: DOSSIER.claims.map((c, i) => (i === 11 ? { ...c, nonce: "zeceipt-challenge-00000000000000000000000000000000" } : c)) }, null, 2);

// Everything that must never appear in a request: the dossier (as JSON, base64url, and its parts) and the viewing key.
const SECRETS = [
  UFVK, UFVK.slice(20, 80), b64(SAMPLE), b64(TAMPERED), b64(SAMPLE).slice(100, 180), DOSSIER.nk, NONCE,
  ...Object.values(DOSSIER.notes), ...Object.values(DOSSIER.receipts).map((r) => r.ock),
];

// ---- a static host ----
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const served = [];
let server, base;
function staticHost(req, res) {
  served.push({ url: req.url, headers: JSON.stringify(req.headers) });
  const url = new URL(req.url, "http://x");
  const p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) { res.writeHead(301, { location: `${url.pathname}/` }).end(); return; }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

// ---- the public testnet node (gRPC-web), intercepted ----
const varint = (n) => { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const frame = (flag, b) => { const f = Buffer.alloc(5 + b.length); f[0] = flag; f.writeUInt32BE(b.length, 1); Buffer.from(b).copy(f, 5); return f; };
const grpcHeaders = { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
/** GetTransaction(TxFilter { hash = 3 }): the txid is the 32 bytes after the frame header and the field tag, reversed. */
const requestedTxid = (body) => Buffer.from(body.subarray(7, 39)).reverse().toString("hex");
function nodeAnswer(txid) {
  const hex = CHAIN[txid];
  if (!hex) return Buffer.concat([frame(0, []), frame(0x80, Buffer.from("grpc-status:5\r\ngrpc-message:transaction not found\r\n"))]);
  const data = Buffer.from(hex, "hex");
  const msg = [0x0a, ...varint(data.length), ...data, 0x10, ...varint(HEIGHTS[txid] ?? 4400000)];
  return Buffer.concat([frame(0, msg), frame(0x80, Buffer.from("grpc-status:0\r\n"))]);
}

let browser;
before(async () => {
  if (!RUN) return;
  const { chromium } = await import("playwright-core");
  server = http.createServer(staticHost);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome" });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

/** A fresh context that records requests, CSP violations, page errors and every status line the page shows. */
async function openPage(contextOptions = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...contextOptions });
  const requests = [];
  const errors = [];
  await context.addInitScript(() => {
    window.__csp = [];
    window.__status = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.getElementById("status");
      if (s) new MutationObserver(() => window.__status.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    });
  });
  await context.route("https://zjs.zec.rocks/testnet/**", (route) => route.fulfill({ status: 200, headers: grpcHeaders, body: nodeAnswer(requestedTxid(route.request().postDataBuffer())) }));
  await context.route("https://zjs.zec.rocks/mainnet/**", (route) => route.fulfill({ status: 200, headers: grpcHeaders, body: nodeAnswer("") }));
  for (const host of ["zcash-mainnet.chainsafe.dev", "zcash-testnet.chainsafe.dev"]) await context.route(`https://${host}/**`, (route) => route.abort());
  const page = await context.newPage();
  page.on("request", async (req) => {
    const entry = { url: req.url(), method: req.method(), headers: "", body: req.postDataBuffer()?.toString("latin1") ?? "" };
    requests.push(entry);
    entry.headers = JSON.stringify(await req.allHeaders().catch(() => req.headers()));
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return { context, page, requests, errors };
}

/** A description list's items as { term: description }. */
const dl = (page, sel) => page.$$eval(`${sel} > div`, (divs) => Object.fromEntries(divs.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])));
/** A table row's cells, each as one line of text. */
const cells = (page, sel) => page.$$eval(`${sel} > td`, (tds) => tds.map((td) => td.textContent.replace(/\s+/g, " ").trim()));
const text = (page, sel) => page.textContent(sel).then((t) => (t ?? "").replace(/\s+/g, " ").trim());
const ready = (page) => page.waitForFunction(() => /^Ready/.test(document.getElementById("status")?.textContent ?? ""));
const caseShown = (page) => page.waitForSelector("#banner:not([hidden])");
const outside = (s) => s.requests.filter((r) => !r.url.startsWith(base));

/** No request carries the dossier or the key; the only outside requests are transaction lookups; nothing is stored. */
async function assertPrivate({ page, requests, errors }, { extraSecrets = [], expectedErrors = [] } = {}) {
  await new Promise((r) => setTimeout(r, 50));
  for (const r of requests) for (const s of [...SECRETS, ...extraSecrets]) {
    assert.ok(!r.url.includes(s) && !r.headers.includes(s) && !r.body.includes(s), `a request carried a secret: ${r.method} ${r.url.slice(0, 80)}`);
  }
  for (const s of served) for (const secret of [...SECRETS, ...extraSecrets]) assert.ok(!s.url.includes(secret) && !s.headers.includes(secret), `the host saw a secret: ${s.url.slice(0, 80)}`);
  for (const r of requests.filter((x) => !x.url.startsWith(base))) {
    assert.match(r.url, /\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/GetTransaction$/, `unexpected outside request ${r.url}`);
    assert.equal(r.body.length, 39, "a lookup carries one txid filter and nothing else");
    assert.ok(!/"referer"/i.test(r.headers), "no Referer on the node request");
  }
  const stored = await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
    idb: (await indexedDB.databases()).length, caches: (await caches.keys()).length, csp: window.__csp,
  }));
  assert.deepEqual(stored, { local: 0, session: 0, cookie: "", idb: 0, caches: 0, csp: [] });
  assert.deepEqual(errors.filter((e) => !expectedErrors.some((re) => re.test(e))), []);
}

async function axe(page, where) {
  const { AxeBuilder } = await import("@axe-core/playwright");
  await page.evaluate(() => document.fonts.ready);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  assert.deepEqual(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), [], `axe on ${where}`);
}

test("case review: the sample button fetches its five transactions with progress, and all 12 claims verify, verdict first", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  assert.equal(outside(s).length, 0, "nothing is fetched before a dossier is opened");
  await s.page.click("#sample");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "All 12 claims verified");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result ok");
  assert.equal(await text(s.page, "#verdict-sub"), "Every claim holds against the chain: 1 origin, 7 path hops, 3 deposits and 1 control answer.");
  assert.equal(await s.page.evaluate(() => document.activeElement?.id), "banner", "the verdict has focus");
  assert.match(await text(s.page, "#verdict-live"), /^All 12 claims verified\. /);
  const statuses = await s.page.evaluate(() => window.__status);
  for (let i = 1; i <= 5; i++) assert.ok(statuses.includes(`Fetching ${i} of 5 from zjs.zec.rocks/testnet…`), `progress ${i}: ${statuses.join(" | ")}`);
  // The case facts: the subject marked unauthenticated, the network, the hash of the file as given, when and where.
  const facts = await dl(s.page, "#facts");
  assert.equal(facts["Subject (unauthenticated)"], DOSSIER.subject);
  assert.equal(facts.Network, "Zcash testnet");
  assert.equal(facts["Dossier sha256"], crypto.createHash("sha256").update(SAMPLE).digest("hex"), "the sha256 of the sample file, byte for byte");
  assert.match(facts.Checked, /^\d{4}-\d\d-\d\d \d\d:\d\d UTC against zjs\.zec\.rocks\/testnet$/);
  assert.equal(facts["Built (per the holder)"], "2026-09-30 12:37 UTC");
  // The funds flow: five steps, oldest first, twelve edges each with its status in words.
  const steps = await s.page.locator("#flow > li.step").allTextContents();
  assert.equal(steps.length, 5);
  assert.match(steps[0], /Step 1Origin: funds enter the holder's wallet.*Height 4419987 · tx 90f6a335…2a4b.*From shielded funds of an undisclosed sender.*n11\.0 TAZ.*spent in step 2/);
  assert.match(steps[1], /Height 4420000.*n2.*n3.*n4.*n5.*r10\.01 TAZ.*to utest19qmz.*INV-T-001/);
  assert.match(steps[4], /Step 5Control: the holder answered the challenge.*Height 4421345.*n40\.2474375 TAZ.*n90\.001 TAZ.*memo “zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8”/);
  assert.equal(await s.page.locator("#flow .edge").count(), 12);
  assert.equal(await s.page.locator("#flow .edge .badge-verified").count(), 12);
  assert.deepEqual(await s.page.locator("#flow .edge .badge").evaluateAll((els) => [...new Set(els.map((e) => e.textContent))]), ["Verified"], "the status is a word, not only a colour");
  // The claims table, the funders, what was disclosed and what is not proven.
  assert.equal(await s.page.locator("#claims tbody tr").count(), 12);
  const first = await cells(s.page, "#claims tbody tr:first-child");
  assert.deepEqual(first.slice(0, 3), ["1", "Origin", "Verified"]);
  assert.match(first[3], /^1\.00000000 TAZ .*90f6a335…2a4b at height 4419987/);
  assert.match(await text(s.page, "#funders"), /No transparent input: it was paid from shielded funds/);
  assert.match(await text(s.page, "#disclosed"), /9 note openings.*nk, the nullifier key.*3 sender receipts/);
  assert.match(await text(s.page, "#limits"), /who the counterparties are.*a legal attestation/);
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "not-generated");
  // Exactly the five lookups, one per transaction, to the testnet node.
  assert.deepEqual(outside(s).map((r) => r.url.replace(/\/cash\.z.*$/, "")), Array(5).fill("https://zjs.zec.rocks/testnet"));
  // The report downloads for the case file.
  const [saved] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  const report = JSON.parse(fs.readFileSync(await saved.path(), "utf8"));
  assert.equal(saved.suggestedFilename(), `zeceipt-case-${report.dossier_sha256.slice(0, 12)}.json`);
  assert.equal(report.version, "zeceipt-dossier-report-v1");
  assert.equal(report.all_verified, true);
  assert.equal(report.claims.length, 12);
  assert.deepEqual(report.case.nodes, ["https://zjs.zec.rocks/testnet"]);
  assert.match(report.case.checked_at, /^\d{4}-\d\d-\d\dT/);
  await assertPrivate(s);
  await s.context.close();
});

test("case review: #sample opens and checks the sample, and a #<base64url> link opens its dossier", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample`);
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "All 12 claims verified", "the README's link checks the sample with no click");
  assert.equal(await s.page.locator("#flow > li.step").count(), 5);
  assert.equal(new URL(s.page.url()).hash, "#sample");
  await s.page.goto(`${base}/case#${b64(SAMPLE)}`); // /case → /case/ keeps the fragment
  await s.page.waitForFunction(() => /claims verified|failed/.test(document.getElementById("headline").textContent) && !document.getElementById("banner").hidden);
  assert.equal(await text(s.page, "#headline"), "All 12 claims verified");
  assert.equal(new URL(s.page.url()).pathname, "/case/");
  await assertPrivate(s);
  await s.context.close();
});

test("case review: a dossier whose control nonce was changed, dropped in as a file, shows the control claim failed", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  await s.page.setInputFiles("#file", { name: "dossier.json", mimeType: "application/json", buffer: Buffer.from(TAMPERED) });
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "1 claim failed");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result bad");
  assert.match(await text(s.page, "#verdict-sub"), /^11 of 12 verified\./);
  const row = await cells(s.page, "#claims tbody tr:last-child");
  assert.deepEqual(row.slice(0, 3), ["12", "Control", "Failed"]);
  assert.match(row[3], /^The reply note's memo does not carry the nonce/);
  assert.match(await text(s.page, "#flow > li.step:last-child"), /Control.*Failed/);
  assert.equal(await s.page.locator("#flow > li.step.tone-failed").count(), 1);
  // A text paste of the untampered dossier replaces it.
  await s.page.click("#inputs > summary");
  await s.page.fill("#paste", SAMPLE);
  await s.page.click("#check");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "All 12 claims verified");
  await assertPrivate(s);
  await s.context.close();
});

test("case review: a nonce generated here is the one the control claim must answer, in memory only", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  assert.equal(await s.page.locator("#nonce-row").isVisible(), false);
  await s.page.click("#nonce-new");
  const nonce = await text(s.page, "#nonce-value");
  assert.match(nonce, /^zeceipt-challenge-[0-9a-f]{32}$/);
  assert.match(await text(s.page, "#challenge"), /send any amount \(the smallest will do\) to their own address, with the nonce as the memo/);
  // The sample answers another reviewer's nonce: with this page's nonce expected, its control claim fails.
  await s.page.click("#sample");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "1 claim failed");
  const row = await cells(s.page, "#claims tbody tr:last-child");
  assert.deepEqual(row.slice(0, 3), ["12", "Control", "Failed"]);
  assert.match(row[3], new RegExp(`answers nonce ${NONCE}, not the one you issued`));
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "mismatch");
  const line = await text(s.page, "#nonce-line");
  assert.ok(line.includes(NONCE) && line.includes(nonce) && /ask the holder to answer yours/.test(line), line);
  assert.equal(await text(s.page, "#nonce-result"), line, "the challenge card says the same");
  // A new nonce re-checks the case on screen, offline: no new lookup.
  const lookups = outside(s).length;
  await s.page.click("#nonce-new");
  const again = await text(s.page, "#nonce-value");
  assert.notEqual(again, nonce);
  await s.page.waitForFunction((n) => document.getElementById("nonce-line").textContent.includes(n), again);
  assert.equal(await text(s.page, "#headline"), "1 claim failed");
  assert.equal(outside(s).length, lookups);
  await assertPrivate(s, { extraSecrets: [nonce, again] });
  await s.context.close();
});

test("case review: the summary copies, and the print layout keeps the case and drops the controls", { skip: !RUN }, async () => {
  const s = await openPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await s.page.goto(`${base}/case/#sample`);
  await caseShown(s.page);
  await s.page.click("#copy-summary");
  await s.page.waitForFunction(() => /copied/.test(document.getElementById("copy-live").textContent));
  const summary = await s.page.evaluate(() => navigator.clipboard.readText());
  assert.match(summary, /^Zeceipt case review: All 12 claims verified\nSubject \(unauthenticated\): Testnet holder/);
  assert.match(summary, /\n12\. Control, verified: .*the holder spent n4 \(0\.24743750 TAZ\)/);
  await s.page.emulateMedia({ media: "print" });
  for (const id of ["inputs", "challenge", "case-actions"]) assert.equal(await s.page.locator(`#${id}`).isVisible(), false, `${id} is not printed`);
  for (const id of ["banner", "flow-card", "claims-card", "scope"]) assert.equal(await s.page.locator(`#${id}`).isVisible(), true, `${id} is printed`);
  assert.match(await text(s.page, "#print-meta"), /^Checked .* UTC in the browser with zeceipt-wasm .* Dossier sha256 [0-9a-f]{64}\.$/);
  await assertPrivate(s);
  await s.context.close();
});

test("build: the published testnet UFVK and the txids rebuild the sample's claims; the key field is cleared and never sent", { skip: !RUN }, async () => {
  const s = await openPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  assert.match(await text(s.page, ".promise h2"), /Your viewing key stays in this page/);
  assert.deepEqual(await s.page.$eval("#ufvk", (e) => [e.getAttribute("autocomplete"), e.getAttribute("spellcheck")]), ["off", "false"]);
  await s.page.selectOption("#network", "test");
  await s.page.fill("#ufvk", UFVK);
  await s.page.fill("#txids", FUNDS.join("\n"));
  await s.page.fill("#nonce", NONCE);
  await s.page.fill("#control-txid", CONTROL);
  await s.page.click("#build");
  await s.page.waitForSelector("#built:not([hidden])");
  assert.equal(await s.page.inputValue("#ufvk"), "", "the key field is cleared once built");
  assert.equal(await text(s.page, "#built-title"), "Dossier built");
  assert.equal(await s.page.getAttribute("#built", "class"), "result ok");
  assert.equal(await s.page.evaluate(() => document.activeElement?.id), "built");
  assert.deepEqual(await dl(s.page, "#built-counts"), { Notes: "9", Receipts: "3", Claims: "12 (1 origin, 7 path hops, 3 deposits and 1 control answer)" });
  assert.match(await text(s.page, "#built-discloses"), /^nk, the nullifier key.*9 note openings.*3 sender receipts/);
  assert.equal(await s.page.locator("#preview tbody tr").count(), 12);
  assert.equal(await s.page.locator("#preview .badge-verified").count(), 12);
  const statuses = await s.page.evaluate(() => window.__status);
  assert.ok(statuses.includes("Built in this page. Nothing was sent but the transaction ids."), statuses.join(" | "));
  const [saved] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  assert.equal(saved.suggestedFilename(), "dossier.json");
  const builtText = fs.readFileSync(await saved.path(), "utf8");
  const built = JSON.parse(builtText);
  assert.deepEqual([built.version, built.network, built.nk, built.notes, built.receipts, built.claims], [DOSSIER.version, DOSSIER.network, DOSSIER.nk, DOSSIER.notes, DOSSIER.receipts, DOSSIER.claims], "the built dossier's claims are the fixture's");
  // The lookups: the four funds transactions, then the challenge, and nothing else.
  const asked = outside(s).map((r) => requestedTxid(Buffer.from(r.body, "latin1")));
  assert.deepEqual(asked, [...FUNDS, CONTROL]);
  // The review link carries the dossier in its fragment; Open in Case review follows it and checks it.
  await s.page.click("#copy-link");
  await s.page.waitForFunction(() => /Review link copied/.test(document.getElementById("link-status").textContent));
  const link = await s.page.evaluate(() => navigator.clipboard.readText());
  assert.equal(link, `${base}/case/#${b64(builtText)}`);
  assert.equal(await s.page.getAttribute("#open-case", "href"), link);
  await assertPrivate(s, { extraSecrets: [b64(builtText)] });
  await s.page.click("#open-case");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "All 12 claims verified");
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "not-generated");
  await assertPrivate(s, { extraSecrets: [b64(builtText)] });
  await s.context.close();
});

test("build: a network mismatch, bad hex and a key that sees nothing are each explained; Forget everything clears the page", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  // The page's network is mainnet by default; the key is testnet's. Nothing is fetched.
  await s.page.fill("#ufvk", UFVK);
  await s.page.fill("#txids", FUNDS.join("\n"));
  await s.page.click("#build");
  await s.page.waitForSelector("#build-error:not([hidden])");
  assert.match(await text(s.page, "#error-text"), /^This viewing key is for Zcash testnet, and the network chosen is Zcash mainnet/);
  assert.equal(await s.page.getAttribute("#network", "aria-invalid"), "true");
  assert.equal(outside(s).length, 0, "a mismatch is caught before any lookup");
  await s.page.selectOption("#network", "test");
  await s.page.fill("#txids", `${FUNDS[0]}\nnot-hex`);
  await s.page.click("#build");
  await s.page.waitForFunction(() => /Line 2 is not a transaction id/.test(document.getElementById("error-text").textContent));
  assert.equal(await s.page.getAttribute("#txids", "aria-invalid"), "true");
  assert.equal(outside(s).length, 0);
  // A real testnet payment the key has no part in.
  await s.page.fill("#txids", ZDP_TEST.txid);
  await s.page.click("#build");
  await s.page.waitForFunction(() => /^This key sees nothing in these transactions/.test(document.getElementById("error-text").textContent));
  assert.equal(await s.page.locator("#built").isVisible(), false);
  assert.equal(await s.page.inputValue("#ufvk"), UFVK, "a failed build keeps the key for a correction");
  // An id no node has.
  await s.page.fill("#txids", "ab".repeat(32));
  await s.page.click("#build");
  await s.page.waitForFunction(() => /^Transaction abababab…abab was not found on Zcash testnet/.test(document.getElementById("error-text").textContent));
  await s.page.click("#forget");
  for (const id of ["ufvk", "txids", "nonce", "control-txid", "subject"]) assert.equal(await s.page.inputValue(`#${id}`), "", `${id} is empty`);
  assert.equal(await s.page.inputValue("#network"), "main");
  assert.equal(await s.page.locator("#build-error").isVisible(), false);
  assert.match(await text(s.page, "#build-status"), /Everything was forgotten/);
  await assertPrivate(s, { expectedErrors: [/Failed to load resource/] });
  await s.context.close();
});

test("landing page: no script, the calls to action and the tools resolve, and the sample link checks the sample", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/`);
  assert.equal(await text(s.page, "h1"), "Prove where your shielded ZEC came from, without handing over your viewing key.");
  assert.equal(await s.page.locator("script").count(), 0);
  const hrefs = await s.page.locator("main a").evaluateAll((as) => as.map((a) => a.href));
  for (const h of hrefs.filter((u) => u.startsWith(base))) {
    const res = await s.context.request.get(h.replace(/#.*$/, ""));
    assert.equal(res.status(), 200, h);
  }
  assert.ok(hrefs.includes(`${base}/case/`) && hrefs.includes(`${base}/build/`) && hrefs.includes(`${base}/case/#sample`) && hrefs.includes(`${base}/r/`) && hrefs.includes(`${base}/demo/`));
  await s.page.click("text=Try the real testnet sample");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "All 12 claims verified");
  await assertPrivate(s);
  await s.context.close();
});

test("axe finds no WCAG A/AA violation on the landing, case and build pages, in every state, light and dark", { skip: !RUN }, async () => {
  for (const colorScheme of ["light", "dark"]) {
    const s = await openPage({ colorScheme, reducedMotion: "reduce" });
    await s.page.goto(`${base}/`);
    await axe(s.page, `${colorScheme}: landing`);
    await s.page.goto(`${base}/case/`);
    await ready(s.page);
    await s.page.click("#nonce-new");
    await axe(s.page, `${colorScheme}: case, empty, with a nonce`);
    await s.page.click("#sample");
    await caseShown(s.page);
    await axe(s.page, `${colorScheme}: case, all verified`);
    await s.page.click("#inputs > summary");
    await s.page.setInputFiles("#file", { name: "dossier.json", mimeType: "application/json", buffer: Buffer.from(TAMPERED) });
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
    await axe(s.page, `${colorScheme}: case, a claim failed`);
    await s.page.click("#inputs > summary");
    await s.page.fill("#paste", "{not a dossier");
    await s.page.click("#check");
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Not a readable dossier");
    await axe(s.page, `${colorScheme}: case, unreadable`);
    await s.page.goto(`${base}/build/`);
    await ready(s.page);
    await axe(s.page, `${colorScheme}: build, empty`);
    await s.page.fill("#ufvk", UFVK);
    await s.page.fill("#txids", FUNDS.join("\n"));
    await s.page.click("#build");
    await s.page.waitForSelector("#build-error:not([hidden])");
    await axe(s.page, `${colorScheme}: build, error`);
    await s.page.selectOption("#network", "test");
    await s.page.fill("#nonce", NONCE);
    await s.page.fill("#control-txid", CONTROL);
    await s.page.click("#build");
    await s.page.waitForSelector("#built:not([hidden])");
    await axe(s.page, `${colorScheme}: build, built`);
    await s.context.close();
  }
});
