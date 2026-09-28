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
const CLAIMED = read(path.join(root, "demo/fixtures/binding-receipt.json")); // key id 2026-09@pay.example.org (W3b)
const WELL_KNOWN = read(path.join(root, "demo/fixtures/binding-well-known.json"));
const WELL_KNOWN_OTHER = read(path.join(root, "demo/fixtures/binding-well-known-other.json"));
const SECRETS = [BEARER, BOUND, TAMPERED, UNSIGNED_HTML, REGTEST, CLAIMED].flatMap((j) => [b64(j), JSON.parse(j).ock]);

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
async function openPage({ height = 3491284n, tip = 3491293n, nodeHex = SYNTH_HEX, holdWasm = null, using = browser, contextOptions = {} } = {}) {
  const context = await using.newContext(contextOptions);
  const requests = [];
  const errors = [];
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const grpcHeaders = { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await context.route("https://zjs.zec.rocks/**", (route) => {
    // GetLatestBlock answers a BlockID { height = 1 } (slice A2); `tip: null` makes the node fail it.
    if (route.request().url().endsWith("/GetLatestBlock")) {
      if (tip === null) return route.fulfill({ status: 503, headers: grpcHeaders, body: "" });
      return route.fulfill({ status: 200, headers: grpcHeaders, body: Buffer.concat([frame(0, [0x08, ...varint(tip)]), frame(0x80, Buffer.from("grpc-status:0\r\n"))]) });
    }
    return route.fulfill({ status: 200, headers: grpcHeaders, body: grpcWeb(nodeHex, height) });
  });
  await context.route("https://zcash-mainnet.chainsafe.dev/**", (route) => route.abort());
  await context.route("https://zcash-testnet.chainsafe.dev/**", (route) => route.abort()); // no test uses testnet; keeps one off the network
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
async function assertPrivate({ page, requests, errors }, { issuerChecks = 0, expectedErrors = [] } = {}) {
  await new Promise((r) => setTimeout(r, 50)); // let the last allHeaders() settle
  for (const r of requests) {
    for (const s of SECRETS) {
      assert.ok(!r.url.includes(s) && !r.headers.includes(s) && !r.body.includes(s), `a request carried a receipt secret: ${r.method} ${r.url.slice(0, 80)}`);
    }
  }
  for (const s of served) for (const secret of SECRETS) assert.ok(!s.url.includes(secret) && !s.headers.includes(secret), `the host saw a receipt secret: ${s.url.slice(0, 80)}`);
  const foreign = requests.filter((r) => !r.url.startsWith(base));
  // The issuer check (spec §7, W3b): a GET of the claimed domain's well-known file, only as many as the test clicked.
  const checks = foreign.filter((r) => /^https:\/\/[^/]+\/\.well-known\/zeceipt\.json$/.test(r.url));
  assert.equal(checks.length, issuerChecks, `issuer checks: ${checks.map((r) => r.url).join(" ")}`);
  for (const r of checks) {
    assert.equal(r.method, "GET");
    assert.ok(!/"referer"/i.test(r.headers) && !/"cookie"/i.test(r.headers), "no Referer or cookie on the issuer check");
  }
  for (const r of foreign.filter((x) => !checks.includes(x))) {
    // The node requests: GetTransaction (the txid filter), and GetLatestBlock (slice A2), which carries nothing: one
    // empty ChainSpec frame.
    assert.match(r.url, /\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/(GetTransaction|GetLatestBlock)$/, `unexpected outside request ${r.url}`);
    if (r.url.endsWith("/GetLatestBlock")) assert.equal(r.body, "\0\0\0\0\0", "the tip request carries nothing");
    assert.ok(!/"referer"/i.test(r.headers), "no Referer on the node request");
  }
  const stored = await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
    idb: (await indexedDB.databases()).length, caches: (await caches.keys()).length, csp: window.__csp,
  }));
  assert.deepEqual(stored, { local: 0, session: 0, cookie: "", idb: 0, caches: 0, csp: [] });
  // Chrome logs a refused request (CORS, a redirect with redirect: "error") to the console; a test names those it expects.
  assert.deepEqual(errors.filter((e) => !expectedErrors.some((re) => re.test(e))), []);
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
  assert.match(await text(s.page, "#fetch-note"), /zjs\.zec\.rocks\/mainnet.*, and any service behind it, learns which transaction you look up/);
  assert.equal(await visible(s.page, "challenge-row"), false);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
  assert.match(await text(s.page, "#payment"), /2\.50000000 ZEC \(250000000 zat\).*INV-2026-0142/);
  assert.equal(await text(s.page, "#inclusion"), "Mined at height 3491284, 10 confirmations, according to zjs.zec.rocks/mainnet. ZIP 315 recommends 10 confirmations before spending funds from an untrusted sender.");
  const issuer = await text(s.page, "#issuer");
  assert.match(issuer, /Signed by key [0-9a-f]{64} \(key id 2026-09\)/);
  assert.match(issuer, /issuer binding: unknown/);
  assert.match(await text(s.page, "#challenge-line"), /Not bound to a challenge/);
  assert.equal(await s.page.getAttribute("#outcome", "class"), "ok", "green only when a node reports it mined");
  const outside = s.requests.filter((r) => !r.url.startsWith(base));
  assert.deepEqual(outside.map((r) => r.url.split("/").pop()), ["GetTransaction", "GetLatestBlock"], "two outside requests: the transaction, then the same node's tip");
  assert.equal(outside[1].body, "\0\0\0\0\0", "the tip request carries nothing (one empty ChainSpec)");
  await assertPrivate(s);
  await s.context.close();
});

test("a node without a usable tip leaves the depth unknown and the verdict alone (slice A2)", { skip: !RUN }, async () => {
  const s = await openPage({ tip: null });
  await s.page.goto(`${base}/r/#${b64(BEARER)}`);
  await ready(s.page);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
  assert.equal(await text(s.page, "#inclusion"), "Mined at height 3491284, according to zjs.zec.rocks/mainnet; the depth is unknown (the node gave no usable chain tip). Check it on an explorer or your own node.");
  assert.equal(await s.page.getAttribute("#outcome", "class"), "ok", "still mined: green");
  await assertPrivate(s, { expectedErrors: [/status of 503/] }); // Chrome logs the node's refused tip request
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
    assert.equal(s.requests.filter((r) => !r.url.startsWith(base) && r.url.endsWith("/GetLatestBlock")).length, 0, "no tip is asked for an unmined transaction");
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
  assert.equal(await s.page.getAttribute("#outcome", "class"), "pending", "no success colour for a transaction nobody vouched for");
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

// ---- the issuer check (spec §7, slice W3b) ----
const WK = "https://pay.example.org/.well-known/zeceipt.json";
async function claimedVerified(s) {
  await s.page.goto(`${base}/r/#${b64(CLAIMED)}`);
  await ready(s.page);
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#headline"), "VALID");
}

test("issuer check: offered only after a valid result, named, and nothing is asked of the domain before the click; confirmed by the domain's file", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.context.route(WK, (route) => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: WELL_KNOWN }));
  await s.page.goto(`${base}/r/#${b64(CLAIMED)}`);
  await ready(s.page);
  assert.equal(await visible(s.page, "binding-row"), false, "not offered before a result");
  await s.page.click("#fetch");
  await verified(s.page);
  assert.equal(await text(s.page, "#check-issuer"), "Check with pay.example.org");
  assert.match(await text(s.page, "#binding-note"), /tells pay\.example\.org that one of its receipts is being checked/);
  assert.equal(s.requests.filter((r) => r.url === WK).length, 0, "no request to the domain before the click");
  await s.page.click("#check-issuer");
  await s.page.waitForFunction(() => /^Confirmed/.test(document.getElementById("binding").textContent));
  assert.match(await text(s.page, "#binding"), /^Confirmed: pay\.example\.org lists this key\. It vouches for the key now/);
  assert.equal(await s.page.getAttribute("#binding", "class"), "ok");
  assert.equal(await text(s.page, "#headline"), "VALID", "the verdict is unchanged");
  await assertPrivate(s, { issuerChecks: 1 });
  await s.context.close();
});

// A missing CORS header is not tested with interception: Playwright's route.fulfill bypasses Chrome's CORS check
// (measured: a fulfilled response without Access-Control-Allow-Origin was read). The last test in this file runs it
// against a real HTTPS origin instead (slice W3c).
test("issuer check: not listed, a redirect and a 404 each leave the receipt VALID and say why", { skip: !RUN }, async () => {
  for (const [name, fulfill, want] of [
    ["another key", { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: WELL_KNOWN_OTHER }, /^Not listed: pay\.example\.org does not list this key\. The payment above is still proven/],
    ["a redirect", { status: 302, headers: { location: "https://evil.example/zeceipt.json", "access-control-allow-origin": "*" }, body: "" }, /^Unknown: pay\.example\.org: the request failed/],
    ["a 404", { status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }, /^Unknown: pay\.example\.org answered HTTP 404/],
  ]) {
    const s = await openPage();
    await s.context.route(WK, (route) => route.fulfill(fulfill));
    await claimedVerified(s);
    await s.page.click("#check-issuer");
    await s.page.waitForFunction(() => !/Checking/.test(document.getElementById("binding").textContent));
    assert.match(await text(s.page, "#binding"), want, name);
    assert.equal(await s.page.getAttribute("#binding", "class"), "pending", `${name}: amber, never red`);
    assert.equal(await text(s.page, "#headline"), "VALID", `${name}: the verdict is unchanged`);
    assert.equal(s.requests.filter((r) => r.url.startsWith("https://evil.example")).length, 0, `${name}: a redirect is never followed`);
    await s.context.close();
  }
});

test("issuer check: not offered for a plain key id or an unsigned receipt", { skip: !RUN }, async () => {
  for (const receipt of [BEARER, UNSIGNED_HTML]) {
    const s = await openPage();
    await s.page.goto(`${base}/r/#${b64(receipt)}`);
    await ready(s.page);
    await s.page.click("#fetch");
    await verified(s.page);
    assert.equal(await visible(s.page, "binding-row"), false);
    await assertPrivate(s);
    await s.context.close();
  }
});

test("the page's CSP admits only the well-known path on other hosts (measured in Chrome)", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.context.route("https://evil.example/**", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  await s.page.goto(`${base}/r/`);
  await ready(s.page);
  const tryFetch = (u) => s.page.evaluate(async (url) => { try { await fetch(url); return "sent"; } catch { return "refused"; } }, u);
  assert.equal(await tryFetch("https://evil.example/other"), "refused", "another path");
  assert.equal(await tryFetch("https://evil.example/.well-known/zeceipt.json"), "sent", "the well-known path");
  const withQuery = await tryFetch("https://evil.example/.well-known/zeceipt.json?leak=1");
  assert.equal(await tryFetch("http://evil.example/.well-known/zeceipt.json"), "refused", "plain http");
  const violations = await s.page.evaluate(() => window.__csp);
  assert.ok(violations.some((v) => /connect-src https:\/\/evil\.example\/other/.test(v)), JSON.stringify(violations));
  console.log(`CSP measurement: the well-known path with a query string was ${withQuery}`);
  await s.context.close();
});

// ---- the issuer check against a real cross-origin HTTPS server (slice W3c, review W3b's optional) ----
// route.fulfill bypasses Chrome's CORS check, so here Chrome's own network stack does the work: a second Chrome maps
// pay.example.org to a local HTTPS server (--host-resolver-rules; --no-proxy-server, or a system proxy would take the
// request), with a certificate made for this run in a temporary directory (never committed) that the context accepts.
test("issuer check against a real HTTPS origin: no CORS header is unknown, the header confirms, a real redirect is not followed", { skip: !RUN }, async () => {
  const { spawnSync } = await import("node:child_process");
  const https = await import("node:https");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeceipt-cors-"));
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=pay.example.org", "-addext", "subjectAltName=DNS:pay.example.org"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  let mode = "no-cors";
  const hits = [];
  const origin = https.createServer({ key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) }, (req, res) => {
    hits.push(req.url);
    if (mode === "redirect") return void res.writeHead(302, { location: "/.well-known/elsewhere.json", "access-control-allow-origin": "*" }).end();
    res.writeHead(200, { "content-type": "application/json", ...(mode === "cors" ? { "access-control-allow-origin": "*" } : {}) }).end(WELL_KNOWN);
  });
  await new Promise((r) => origin.listen(0, "127.0.0.1", r));
  const real = await chromium.launch({ channel: "chrome", args: [`--host-resolver-rules=MAP pay.example.org:443 127.0.0.1:${origin.address().port}`, "--no-proxy-server"] });
  try {
    // Exactly the messages Chrome prints (measured, slice W3d after review W3c): nothing broader may pass unnoticed.
    const failedLoad = /^Failed to load resource: net::ERR_FAILED$/;
    const refused = [/^Access to fetch at 'https:\/\/pay\.example\.org\/\.well-known\/zeceipt\.json' from origin 'http:\/\/127\.0\.0\.1:\d+' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource\.$/, failedLoad];
    const redirected = [failedLoad];
    for (const [m, want, cls, expectedErrors] of [
      ["no-cors", /^Unknown: pay\.example\.org: the request failed/, "pending", refused],
      ["cors", /^Confirmed: pay\.example\.org lists this key/, "ok", []],
      ["redirect", /^Unknown: pay\.example\.org: the request failed/, "pending", redirected],
    ]) {
      mode = m;
      hits.length = 0;
      const s = await openPage({ using: real, contextOptions: { ignoreHTTPSErrors: true } });
      await claimedVerified(s);
      await s.page.click("#check-issuer");
      await s.page.waitForFunction(() => !/Checking/.test(document.getElementById("binding").textContent));
      assert.match(await text(s.page, "#binding"), want, m);
      assert.equal(await s.page.getAttribute("#binding", "class"), cls, m);
      assert.equal(await text(s.page, "#headline"), "VALID", `${m}: the verdict is unchanged`);
      assert.deepEqual(hits, ["/.well-known/zeceipt.json"], `${m}: exactly one request reached the domain, and a redirect was not followed`);
      await assertPrivate(s, { issuerChecks: 1, expectedErrors });
      if (m === "no-cors") assert.ok(s.errors.some((e) => refused[0].test(e)), "Chrome's own CORS refusal happened");
      await s.context.close();
    }
  } finally {
    await real.close();
    origin.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
