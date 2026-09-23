// Chrome e2e for the public receipt page (r/index.html, slice F2b). Opt-in: ZECEIPT_BROWSER_E2E=1.
// Drives the installed Google Chrome through playwright-core. The page is served by a tiny static
// server that behaves like a static host (/r → 301 /r/). The public gRPC-web node is intercepted,
// so no internet is needed. Every request the page makes is recorded, to prove the receipt payload
// (and its OCK) never leaves the browser.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const RUN = process.env.ZECEIPT_BROWSER_E2E === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const repo = path.join(root, "..", "..");
const { STAGE_COPY, NOT_FOUND_COPY } = await import("../r/view.js");

const read = (p) => fs.readFileSync(p, "utf8").trim();
const b64 = (json) => Buffer.from(json).toString("base64url");
const BEARER = read(path.join(root, "demo/fixtures/synthetic-receipt-bearer.json"));
const BOUND = read(path.join(root, "demo/fixtures/synthetic-receipt.json"));
const SYNTH_HEX = read(path.join(root, "demo/fixtures/synthetic-ironwood.hex"));
const REGTEST = read(path.join(repo, "fixtures/regtest-receipt.json"));
const REGTEST_HEX_FILE = path.join(repo, "fixtures/regtest-48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d.hex");
const variant = (json, mut) => { const o = JSON.parse(json); mut(o); return JSON.stringify(o); };
const TAMPERED = variant(BEARER, (o) => { o.label += " (edited)"; });
const UNSIGNED_HTML = variant(BEARER, (o) => { delete o.signature; delete o.issuer_pubkey; delete o.issuer_key_id; o.label = "x <b>bold</b> y"; });

// Everything that must never appear in a request: each test receipt's payload and OCK.
const SECRETS = [BEARER, BOUND, TAMPERED, UNSIGNED_HTML, REGTEST].flatMap((j) => [b64(j), JSON.parse(j).ock]);

// ---- a static host ----
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
const served = [];
let server, base;
function staticHost(req, res) {
  served.push({ url: req.url, headers: JSON.stringify(req.headers) });
  const url = new URL(req.url, "http://x");
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
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

// ---- the public node (gRPC-web), intercepted ----
const varint = (n) => { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const frame = (flag, b) => { const f = Buffer.alloc(5 + b.length); f[0] = flag; f.writeUInt32BE(b.length, 1); Buffer.from(b).copy(f, 5); return f; };
function grpcWeb(hex, height) {
  const data = Buffer.from(hex, "hex");
  const msg = [0x0a, ...varint(data.length), ...data];
  if (height !== undefined) msg.push(0x10, ...varint(height));
  return Buffer.concat([frame(0, msg), frame(0x80, Buffer.from("grpc-status:0\r\n"))]);
}

let chromium, browser;
before(async () => {
  if (!RUN) return;
  ({ chromium } = await import("playwright-core"));
  server = http.createServer(staticHost);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome" });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

/** A fresh browser context that records requests, CSP violations and page errors. */
async function openPage({ height = 3491284n, nodeHex = SYNTH_HEX, holdWasm = null } = {}) {
  const context = await browser.newContext();
  const requests = [];
  const errors = [];
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await context.route("https://zjs.zec.rocks/**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: grpcWeb(nodeHex, height) }));
  await context.route("https://zcash-mainnet.chainsafe.dev/**", (route) => route.abort());
  if (holdWasm) await context.route("**/pkg/zeceipt_wasm_bg.wasm", async (route) => { await holdWasm; await route.continue(); });
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

const text = (page, sel) => page.textContent(sel).then((t) => (t ?? "").replace(/\s+/g, " ").trim());
const visible = (page, id) => page.locator(`#${id}`).isVisible();
async function ready(page) { await page.waitForFunction(() => /verification runs in this page/.test(document.getElementById("status").textContent)); }
async function verified(page) { await page.waitForSelector("#outcome:not([hidden])"); }

/** No recorded request may carry a payload or an OCK, and nothing may be stored or blocked. */
async function assertPrivate({ page, requests, errors }) {
  await new Promise((r) => setTimeout(r, 50)); // let the last allHeaders() settle
  for (const r of requests) {
    for (const s of SECRETS) {
      assert.ok(!r.url.includes(s) && !r.headers.includes(s) && !r.body.includes(s), `a request carried a receipt secret: ${r.method} ${r.url.slice(0, 80)}`);
    }
  }
  for (const s of served) for (const secret of SECRETS) assert.ok(!s.url.includes(secret) && !s.headers.includes(secret), `the host saw a receipt secret: ${s.url.slice(0, 80)}`);
  const foreign = requests.filter((r) => !r.url.startsWith(base));
  for (const r of foreign) {
    assert.match(r.url, /\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/GetTransaction$/, `unexpected outside request ${r.url}`);
    assert.ok(!/"referer"/i.test(r.headers), "no Referer on the node request");
  }
  const stored = await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
    idb: (await indexedDB.databases()).length, caches: (await caches.keys()).length, csp: window.__csp,
  }));
  assert.deepEqual(stored, { local: 0, session: 0, cookie: "", idb: 0, caches: 0, csp: [] });
  assert.deepEqual(errors, []);
}

test("a bearer receipt opened by its link: summary first, then VALID with the three parts; nothing leaves the browser", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/r#${b64(BEARER)}`); // the static host redirects /r → /r/, keeping the fragment
  assert.equal(new URL(s.page.url()).pathname, "/r/");
  await ready(s.page);
  assert.ok(await visible(s.page, "receipt"));
  const summary = await text(s.page, "#summary");
  assert.match(summary, /Zcash mainnet/);
  assert.match(summary, /bearer receipt/);
  assert.equal(s.requests.filter((r) => !r.url.startsWith(base)).length, 0, "nothing is fetched before the click");
  assert.match(await text(s.page, "#fetch-note"), /zjs\.zec\.rocks\/mainnet.*learns which transaction you look up/);
  assert.equal(await visible(s.page, "challenge-row"), false);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
  assert.match(await text(s.page, "#payment"), /2\.50000000 ZEC \(250000000 zat\).*INV-2026-0142/);
  assert.equal(await text(s.page, "#inclusion"), "Mined at height 3491284, according to zjs.zec.rocks/mainnet. This page does not count confirmations: check the depth on an explorer or your own node.");
  const issuer = await text(s.page, "#issuer");
  assert.match(issuer, /Signed by key [0-9a-f]{64} \(key id 2026-09\)/);
  assert.match(issuer, /issuer binding: unknown/);
  assert.match(await text(s.page, "#challenge-line"), /Not bound to a challenge/);
  assert.equal(s.requests.filter((r) => !r.url.startsWith(base)).length, 1, "exactly one outside request: GetTransaction");
  await assertPrivate(s);
  await s.context.close();
});

test("chain inclusion follows the node: mempool is pending, a fork is not on the main chain", { skip: !RUN }, async () => {
  for (const [height, re, cls] of [[0n, /^Pending: zjs\.zec\.rocks\/mainnet has it in the mempool; it is not mined yet/, "pending"], [0xffffffffffffffffn, /^Not on the main chain: zjs\.zec\.rocks\/mainnet reports it mined on a fork/, "pending"]]) {
    const s = await openPage({ height });
    await s.page.goto(`${base}/r/#${b64(BEARER)}`);
    await ready(s.page);
    await s.page.click("#fetch");
    await verified(s.page);
    assert.equal(await text(s.page, "#headline"), "VALID", "the disclosure itself is valid");
    assert.match(await text(s.page, "#inclusion"), re);
    assert.equal(await s.page.getAttribute("#outcome", "class"), cls);
    await assertPrivate(s);
    await s.context.close();
  }
});

test("a transaction the node does not have: 04's pending copy, no outcome", { skip: !RUN }, async () => {
  const s = await openPage({ nodeHex: "" });
  await s.page.goto(`${base}/r/#${b64(BEARER)}`);
  await ready(s.page);
  await s.page.click("#fetch");
  await s.page.waitForFunction(() => /not found/.test(document.getElementById("source-status").textContent));
  assert.ok((await text(s.page, "#source-status")).startsWith(NOT_FOUND_COPY));
  assert.equal(await visible(s.page, "outcome"), false);
  await s.context.close();
});

test("a challenge-bound receipt waits for the challenge: wrong is INVALID at challenge, right is VALID and matched", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/r/#${b64(BOUND)}`);
  await ready(s.page);
  assert.ok(await visible(s.page, "challenge-row"));
  assert.match(await text(s.page, "#summary"), /bound — enter the challenge you sent/);
  await s.page.click("#fetch");
  await s.page.waitForFunction(() => /Enter the challenge you sent/.test(document.getElementById("source-status").textContent));
  assert.equal(await visible(s.page, "outcome"), false);
  await s.page.fill("#challenge", "not-the-nonce");
  await s.page.click("#verify");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "INVALID");
  assert.equal(await text(s.page, "#stage-copy"), STAGE_COPY.challenge);
  await s.page.fill("#challenge", "auditor-nonce-7");
  await s.page.click("#verify");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "VALID");
  assert.match(await text(s.page, "#challenge-line"), /Bound to your challenge, and it matched/);
  await assertPrivate(s);
  await s.context.close();
});

test("a label edited after signing is INVALID at signature; an unsigned receipt says so and renders its label as text", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/r/#${b64(TAMPERED)}`);
  await ready(s.page);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "INVALID");
  assert.equal(await text(s.page, "#stage-copy"), STAGE_COPY.signature);

  await s.page.evaluate((p) => { location.hash = p; }, b64(UNSIGNED_HTML)); // same tab: hashchange, no reload
  await s.page.waitForFunction(() => document.getElementById("outcome").hidden);
  assert.match(await text(s.page, "#summary"), /none \(unsigned\)/);
  assert.match(await text(s.page, "#summary"), /x <b>bold<\/b> y/);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
  assert.match(await text(s.page, "#issuer"), /^Unsigned: the label is the sender's unauthenticated text/);
  assert.match(await text(s.page, "#payment"), /x <b>bold<\/b> y/);
  assert.equal(await s.page.locator("main b").count(), 0, "no element is injected from the label");
  await assertPrivate(s);
  await s.context.close();
});

test("regtest: no public node, the file load verifies with inclusion unknown", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/r/#${b64(REGTEST)}`);
  await ready(s.page);
  assert.equal(await visible(s.page, "fetch"), false);
  assert.match(await text(s.page, "#fetch-note"), /No public node serves the local regtest chain \(development only\)\. Load the raw transaction from a file instead\./);
  await s.page.fill("#challenge", "auditor-nonce-9");
  await s.page.setInputFiles("#rawfile", REGTEST_HEX_FILE);
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
  assert.match(await text(s.page, "#payment"), /2\.50000000 ZEC/);
  assert.equal(await text(s.page, "#inclusion"), "Unknown: the transaction was loaded from a file. Check the txid on an explorer or your own node.");
  assert.equal(s.requests.filter((r) => !r.url.startsWith(base)).length, 0, "a file load makes no outside request");
  await assertPrivate(s);
  await s.context.close();
});

test("no receipt, or not a receipt: the empty-link screen and 04's parse copy", { skip: !RUN }, async () => {
  const s = await openPage();
  for (const link of [`${base}/r/`, `${base}/r/#`]) {
    await s.page.goto(link);
    await ready(s.page);
    assert.ok(await visible(s.page, "empty"), link);
    assert.equal(await visible(s.page, "receipt"), false);
  }
  await s.page.goto(`${base}/r/#hello`);
  await s.page.waitForSelector("#unreadable:not([hidden])");
  assert.equal(await text(s.page, "#unreadable-copy"), STAGE_COPY.parse);
  await s.context.close();
});

test("what a result proves is on screen before the verifier has loaded", { skip: !RUN }, async () => {
  let release;
  const s = await openPage({ holdWasm: new Promise((r) => { release = r; }) });
  await s.page.goto(`${base}/r/#${b64(BEARER)}`);
  await s.page.getByText("What a valid result proves").waitFor();
  assert.equal(await text(s.page, "#status"), "Loading the verifier…");
  assert.ok(await s.page.getByText("What a valid result proves").isVisible());
  assert.ok(await s.page.getByText("What it does not prove").isVisible());
  release();
  await ready(s.page);
  assert.ok(await visible(s.page, "receipt"));
  await s.context.close();
});
