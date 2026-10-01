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
// The heights the testnet node reported for these transactions (checked live on 2026-09-30), and those of the
// transparent sample's payment out (52af3e0d) and return (c28b6000), from the conformance vectors.
const VECTORS = JSON.parse(read(path.join(repo, "spec/test-vectors/dossier-v1.json")));
const OUT_AND_BACK = ["52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e", "c28b60004cd8d9fc08ab75ff44aa3062a4d79bdfc29653db8765991b5ae5cefe"];
const HEIGHTS = { [FUNDS[0]]: 4419987, [FUNDS[1]]: 4420000, [FUNDS[2]]: 4420003, [FUNDS[3]]: 4420005, [CONTROL]: 4421345, [OUT_AND_BACK[0]]: VECTORS.heights[OUT_AND_BACK[0]], [OUT_AND_BACK[1]]: VECTORS.heights[OUT_AND_BACK[1]] };
// The exchange deposit review (the flagship sample): the hot wallet's funding, the withdrawal to the customer (origin),
// their deposit back to the exchange (transparent payment) and their control answer, at the heights the testnet node
// reported (checked live on 2026-10-01).
const EXCHANGE = { "773da0147a8d0ba05f4bfe1e0a08a89dbfefda11b792172f7ebd71aeb56b4b0d": 4422275, "5146f38c0a782f0d76858e575c46c3b0908865987416095e4180a2c6273436e6": 4422279, a51d12711cd68729699ee93ea3e466bfb0222c7f3a02c2f64bd3b66ed60985cf: 4422295, "14a9551d4b85b05ce48dc6e83784bdb8bad0a68b6ec2a5e2298b2f77bb79cce6": 4422305 };
Object.assign(HEIGHTS, EXCHANGE);
const EXCHANGE_DOSSIER = read(path.join(repo, "fixtures/dossier/testnet-dossier-exchange.json"));
// The beacon sample (PROOF §10): the exchange customer's funds carried on to a control answering the hash of block
// 4426425, mined at 4426430; the node reports that block as it did live.
const BEACON_DOSSIER = read(path.join(repo, "fixtures/dossier/testnet-dossier-beacon.json"));
const BEACON_TX = "701df8b1c1ac49037290fc6e363f3d2c8315ecdeb6c50891fbee4ad9a83970ce";
HEIGHTS[BEACON_TX] = VECTORS.heights[BEACON_TX];
const BEACON_BLOCK = { height: 4426425, hash: "00000f9702b40e9cd12eaf29214f14ab55f8a4edce089f83f4174b2657ce4b7f", time: 1790837358 };
const BEACON_NONCE = `zeceipt-beacon-${BEACON_BLOCK.height}-${BEACON_BLOCK.hash}`;
// The tips the intercepted nodes report, for a nonce's H₀.
const TIPS = { test: 4421700, main: 3100000 };
const TRANSPARENT = read(path.join(repo, "fixtures/dossier/testnet-dossier-transparent-origin.json"));
const WASM_SHA = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "pkg/zeceipt_wasm_bg.wasm"))).digest("hex");
const PARTIAL = "Claims verified — control not shown";
const OFFLINE = "Consistent with the files you loaded — not checked against the chain";
const PARTLY = "Claims verified — funds not fully explained";
const ZDP_TEST = JSON.parse(read(path.join(repo, "fixtures/zdp/testnet.json"))); // a testnet payment the issuer's key does not see
const CHAIN = Object.fromEntries([...FUNDS, CONTROL, ...OUT_AND_BACK, ...Object.keys(EXCHANGE), BEACON_TX].map((t) => [t, read(path.join(repo, "fixtures/testnet", `${t}.hex`)).trim()]));
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
const varintBytes = (n) => { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const frame = (flag, b) => { const f = Buffer.alloc(5 + b.length); f[0] = flag; f.writeUInt32BE(b.length, 1); Buffer.from(b).copy(f, 5); return f; };
const grpcHeaders = { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
/** GetTransaction(TxFilter { hash = 3 }): the txid is the 32 bytes after the frame header and the field tag, reversed. */
const requestedTxid = (body) => Buffer.from(body.subarray(7, 39)).reverse().toString("hex");
/** GetLatestBlock: BlockID { height = 1 }. */
const tipAnswer = (height) => Buffer.concat([frame(0, [0x08, ...varint(height)]), frame(0x80, Buffer.from("grpc-status:0\r\n"))]);
const readVarint = (b, i) => { let v = 0n, sh = 0n; for (;;) { const x = b[i++]; v |= BigInt(x & 0x7f) << sh; if (!(x & 0x80)) return [Number(v), i]; sh += 7n; } };
/** GetBlock(BlockID { height = 1 }): the height after the frame header and the field tag. */
const requestedHeight = (body) => readVarint(body, 6)[0];
/** A block's hash and time as the intercepted node reports them: the beacon's real block, a made-up one at any other height. */
const blockId = (height) => (height === BEACON_BLOCK.height ? BEACON_BLOCK : { height, hash: crypto.createHash("sha256").update(`block ${height}`).digest("hex"), time: 1790000000 + (height % 1000) * 75 });
/** GetBlock's answer, a CompactBlock { height = 2, hash = 3 (internal byte order), time = 5 }. */
function blockAnswer(height) {
  const b = blockId(height);
  const msg = [0x10, ...varint(height), 0x1a, 32, ...Buffer.from(b.hash, "hex").reverse(), 0x28, ...varint(b.time)];
  return Buffer.concat([frame(0, msg), frame(0x80, Buffer.from("grpc-status:0\r\n"))]);
}
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
  const answer = (net) => (route) => {
    const url = route.request().url();
    const body = url.endsWith("/GetLatestBlock") ? tipAnswer(TIPS[net])
      : url.endsWith("/GetBlock") ? blockAnswer(requestedHeight(route.request().postDataBuffer()))
        : nodeAnswer(net === "test" ? requestedTxid(route.request().postDataBuffer()) : "");
    return route.fulfill({ status: 200, headers: grpcHeaders, body });
  };
  await context.route("https://zjs.zec.rocks/testnet/**", answer("test"));
  await context.route("https://zjs.zec.rocks/mainnet/**", answer("main"));
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
const lookups = (s) => outside(s).filter((r) => r.url.endsWith("/GetTransaction"));
const blockLookups = (s) => outside(s).filter((r) => r.url.endsWith("/GetBlock")).map((r) => requestedHeight(Buffer.from(r.body, "latin1")));

/** No request carries the dossier or the key; the only outside requests are transaction lookups; nothing is stored. */
async function assertPrivate({ page, requests, errors }, { extraSecrets = [], expectedErrors = [] } = {}) {
  await new Promise((r) => setTimeout(r, 50));
  for (const r of requests) for (const s of [...SECRETS, ...extraSecrets]) {
    assert.ok(!r.url.includes(s) && !r.headers.includes(s) && !r.body.includes(s), `a request carried a secret: ${r.method} ${r.url.slice(0, 80)}`);
  }
  for (const s of served) for (const secret of [...SECRETS, ...extraSecrets]) assert.ok(!s.url.includes(secret) && !s.headers.includes(secret), `the host saw a secret: ${s.url.slice(0, 80)}`);
  for (const r of requests.filter((x) => !x.url.startsWith(base))) {
    assert.match(r.url, /\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/(GetTransaction|GetLatestBlock|GetBlock)$/, `unexpected outside request ${r.url}`);
    // A lookup carries one txid filter and nothing else; a tip request, an empty ChainSpec; a block request, a height.
    if (r.url.endsWith("/GetBlock")) {
      const b = Buffer.from(r.body, "latin1");
      assert.ok(b[5] === 0x08 && readVarint(b, 6)[1] === b.length, `${r.url} carries only a height`);
    } else assert.equal(r.body.length, r.url.endsWith("/GetLatestBlock") ? 5 : 39, `${r.url} carries only its filter`);
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

test("case review: the sample button fetches its five transactions with progress; all 12 claims verify, amber (its faucet origin names no source), verdict first", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  assert.equal(outside(s).length, 0, "nothing is fetched before a dossier is opened");
  await s.page.click("#sample");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await s.page.getAttribute("#banner", "class"), "result partial");
  assert.equal(await text(s.page, "#verdict-sub"), "All 12 claims hold against the chain (1 origin, 7 path hops, 3 deposits and 1 control answer), but they do not explain all of the funds: origin n1 names no source: an undisclosed shielded sender. Ask the holder who sent the funds of n1, and for their evidence: the chain shows no source for them. The control claim is not matched to your nonce: enter the nonce you issued under “Challenge the holder”. That is the right result for this sample: its funds came from the testnet faucet, which pays from the shielded pool, so the chain cannot show where they came from (spec §5.6).");
  assert.equal(await s.page.evaluate(() => document.activeElement?.id), "banner", "the verdict has focus");
  assert.match(await text(s.page, "#verdict-live"), new RegExp(`^${PARTLY}\\. `));
  // The decision summary, above the facts.
  const decision = await dl(s.page, "#decision");
  assert.deepEqual(Object.keys(decision), ["Arrived at origins", "Paid out", "Under control", "Explained", "Claims"]);
  assert.equal(decision.Explained, "NoOrigin n1 names no source: an undisclosed shielded sender.");
  assert.match(decision["Arrived at origins"], /^1\.0 TAZ in 1 note1\.0 TAZ from an undisclosed shielded sender\.$/);
  assert.match(decision["Paid out"], /^0\.06 TAZ in 3 payments/);
  assert.match(decision["Under control"], /^Not shown.*enter the nonce you issued/);
  assert.match(decision.Claims, /^12 verified/);
  // The verifier's own sha256, computed in the page from the wasm it loaded.
  await s.page.waitForSelector("#wasm-sha:not([hidden])");
  assert.equal(await text(s.page, "#wasm-sha"), `Verifier: zeceipt_wasm_bg.wasm sha256 ${WASM_SHA}`);
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
  assert.match(steps[0], /Step 1Origin: funds enter the holder's wallet.*Height 4419987 · tx 90f6a335…2a4b.*From shielded funds of an undisclosed sender.*n11\.0 TAZnames no sourcespent in step 2.*Origin n1 names no source: an undisclosed shielded sender: this dossier does not explain where these funds came from\..*#1 OriginFunds reach the holder as n1Verifiednames no source: an undisclosed shielded sender/);
  assert.equal(await text(s.page, "#claims tbody tr:first-child .row-flag"), "Names no source: an undisclosed shielded sender. The funds of n1 are not explained by this dossier.");
  assert.match(steps[1], /Height 4420000.*n2.*n3.*n4.*n5.*r10\.01 TAZ.*to utest19qmz.*INV-T-001/);
  assert.match(steps[1], /#2–#5 Pathn1 → n2, n3, n4, n5 in fcfde625…7f0bVerified/, "the four path claims from n1 share one line");
  // Before the reviewer's nonce is entered, the dossier's own shows by its beginning only (E04).
  assert.match(steps[4], /Step 5Control: the holder answered the challenge.*Height 4421345.*n40\.2474375 TAZ.*n90\.001 TAZ.*memo “zeceipt-challenge-eadb…”/);
  assert.equal(await s.page.locator("#flow .edge").count(), 8, "12 claims on 8 lines: paths from one note in one transaction merged");
  assert.equal(await s.page.locator("#flow .edge .badge-verified").count(), 8);
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
  assert.equal(await text(s.page, "#nonce-line"), "The control claim answers a nonce beginning zeceipt-challenge-eadb…. Enter the nonce you issued under “Challenge the holder” (paste it from your case record, not from this page), and the page checks the claim against it.");
  assert.ok(!(await s.page.evaluate(() => document.body.innerText)).includes(NONCE), "the dossier's nonce is nowhere on the page to copy");
  // Exactly the five lookups, one per transaction, to the testnet node.
  assert.deepEqual(outside(s).map((r) => r.url.replace(/\/cash\.z.*$/, "")), Array(5).fill("https://zjs.zec.rocks/testnet"));
  assert.equal(await s.page.getAttribute("#claims tbody tr:first-child td.state .badge", "title"), "Verified: the chain supports this claim.", "a status explains itself");
  // The report downloads for the case file.
  const [saved] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  const report = JSON.parse(fs.readFileSync(await saved.path(), "utf8"));
  assert.equal(saved.suggestedFilename(), `zeceipt-case-${report.dossier_sha256.slice(0, 12)}.json`);
  assert.equal(report.version, "zeceipt-dossier-report-v1");
  assert.equal(report.all_verified, true);
  assert.equal(report.assurance, "verified_partly_explained");
  assert.deepEqual(report.unexplained_origins, ["n1"]);
  assert.equal(report.case.verifier_wasm_sha256, WASM_SHA);
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
  assert.equal(await text(s.page, "#headline"), PARTLY, "the README's link checks the sample with no click");
  assert.equal(await s.page.locator("#flow > li.step").count(), 5);
  assert.equal(new URL(s.page.url()).hash, "#sample");
  await s.page.goto(`${base}/case#${b64(SAMPLE)}`); // /case → /case/ keeps the fragment
  await s.page.waitForFunction(() => /Claims verified|failed/.test(document.getElementById("headline").textContent) && !document.getElementById("banner").hidden);
  assert.equal(await text(s.page, "#headline"), PARTLY);
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
  await s.page.waitForFunction((h) => document.getElementById("headline").textContent === h, PARTLY);
  // A dossier the verifier cannot read: one plain sentence, and the verifier's words in a fold.
  await s.page.click("#inputs > summary");
  await s.page.fill("#paste", JSON.stringify({ ...DOSSIER, holdings: [] }));
  await s.page.click("#check");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Not a readable dossier");
  assert.equal(await text(s.page, "#verdict-sub"), "It has a field, “holdings”, that a zeceipt-dossier-v1 dossier does not have: it was edited, or made by another tool or version.");
  assert.equal(await s.page.locator("#parse-raw").isVisible(), false, "the raw error is folded");
  await s.page.click("#parse-detail > summary");
  assert.match(await text(s.page, "#parse-raw"), /^json: unknown field `holdings`, expected one of `version`/);
  await assertPrivate(s);
  await s.context.close();
});

test("case review: a nonce generated here, with its height H₀, is the one the control claim must answer; kept in the fields only", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  assert.equal(await s.page.inputValue("#nonce-input"), "");
  await s.page.selectOption("#challenge-network", "test");
  await s.page.click("#nonce-new");
  await s.page.waitForFunction(() => /^Issued at height/.test(document.getElementById("h0-status").textContent));
  const nonce = await s.page.inputValue("#nonce-input");
  assert.match(nonce, /^zeceipt-challenge-[0-9a-f]{32}$/);
  assert.equal(await s.page.inputValue("#h0-input"), String(TIPS.test), "H₀ is the node's tip");
  assert.match(await text(s.page, "#h0-status"), new RegExp(`^Issued at height ${TIPS.test} \\(H₀, Zcash testnet\\), \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC\\.`));
  assert.match(await text(s.page, "#challenge"), /send any amount \(the smallest will do\) to their own address, with the nonce as the memo/);
  // The sample answers another reviewer's nonce: with this page's nonce expected, its control claim fails.
  await s.page.click("#sample");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "1 claim failed");
  const row = await cells(s.page, "#claims tbody tr:last-child");
  assert.deepEqual(row.slice(0, 3), ["12", "Control", "Failed"]);
  assert.match(row[3], /answers nonce zeceipt-challenge-eadb…, not the one you issued/);
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "mismatch");
  const line = await text(s.page, "#nonce-line");
  assert.ok(!line.includes(NONCE) && line.includes("a nonce beginning zeceipt-challenge-eadb…") && line.includes(nonce) && /ask the holder to answer yours/.test(line), line);
  assert.ok(!(await s.page.evaluate(() => document.body.innerText)).includes(NONCE), "a mismatch does not give the dossier's nonce away either");
  assert.equal(await text(s.page, "#nonce-result"), line, "the challenge card says the same");
  // A new nonce re-checks the case on screen, offline: no new transaction lookup (only the tip is asked).
  const before = lookups(s).length;
  await s.page.click("#nonce-new");
  await s.page.waitForFunction((n) => document.getElementById("nonce-input").value !== n, nonce);
  const again = await s.page.inputValue("#nonce-input");
  await s.page.waitForFunction((n) => document.getElementById("nonce-line").textContent.includes(n), again);
  assert.equal(await text(s.page, "#headline"), "1 claim failed");
  assert.equal(lookups(s).length, before);
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
  assert.match(summary, new RegExp(`^Zeceipt case review: ${PARTLY}\\n.*\\nSubject \\(unauthenticated\\): Testnet holder`));
  assert.match(summary, /\n12\. Control, verified: .*the holder spent n4 \(0\.24743750 TAZ\)/);
  await s.page.fill("#case-reviewer", "A. Reviewer");
  await s.page.fill("#case-id", "KYC-2026-0417");
  await s.page.emulateMedia({ media: "print" });
  for (const id of ["inputs", "challenge", "case-actions", "glossary-card", "after-card"]) assert.equal(await s.page.locator(`#${id}`).isVisible(), false, `${id} is not printed`);
  for (const id of ["banner", "flow-card", "claims-card", "scope", "decision-wrap", "case-fields", "print-meta"]) assert.equal(await s.page.locator(`#${id}`).isVisible(), true, `${id} is printed`);
  assert.equal(await s.page.locator("button:visible, .btn:visible").count(), 0, "no button on paper");
  assert.deepEqual([await s.page.inputValue("#case-reviewer"), await s.page.inputValue("#case-id")], ["A. Reviewer", "KYC-2026-0417"]);
  // Whole transaction ids on paper.
  const printed = await s.page.locator("#flow .step-tx").first().innerText();
  assert.ok(printed.includes(FUNDS[0]) && !printed.includes("90f6a335…2a4b"), printed);
  assert.match(await text(s.page, "#print-meta"), new RegExp(`^Checked .* UTC in the browser with zeceipt-wasm .*\\. Report made \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC\\. Verifier zeceipt_wasm_bg\\.wasm sha256 ${WASM_SHA}\\. Dossier sha256 [0-9a-f]{64}\\. The notes' nullifiers are not printed\\.$`));
  await s.page.emulateMedia({ media: "screen" });
  await s.page.click("#copy-summary");
  await s.page.waitForFunction(() => /copied/.test(document.getElementById("copy-live").textContent));
  assert.match(await s.page.evaluate(() => navigator.clipboard.readText()), /\nReviewer: A\. Reviewer\nCase id: KYC-2026-0417\n/);
  await assertPrivate(s);
  await s.context.close();
});

test("case review: the nonce the faucet sample answered, at its H₀, shows control but stays amber (its origin names no source, as it should); a later H₀ fails its control, and the challenge copies for the case file", { skip: !RUN }, async () => {
  const s = await openPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await s.page.goto(`${base}/case/#sample`);
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await s.page.locator("#sample-nonce").isVisible(), true, "the sample offers its challenge");
  const fetched = lookups(s).length;
  await s.page.click("#sample-nonce");
  await s.page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "match");
  assert.equal(await text(s.page, "#headline"), PARTLY, "control shown, and the funds still not fully explained: the faucet is an undisclosed shielded sender");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result partial");
  assert.deepEqual([await s.page.inputValue("#nonce-input"), await s.page.inputValue("#h0-input")], [NONCE, "4421300"]);
  assert.match(await text(s.page, "#verdict-sub"), /origin n1 names no source: an undisclosed shielded sender\..* The control claim answers the nonce you issued, after height 4421300\. That is the right result for this sample: its funds came from the testnet faucet, which pays from the shielded pool/);
  assert.equal((await dl(s.page, "#decision"))["Under control"], "0.2474375 TAZn4, spent in answer to your nonce at height 4421345 (issued at height 4421300).");
  assert.equal((await dl(s.page, "#facts"))["Nonce issued at height"], "4421300");
  assert.equal(await s.page.locator("#sample-nonce").isVisible(), false);
  assert.equal(lookups(s).length, fetched, "checked again with the transactions already fetched");
  // An H₀ after the challenge was mined: the control claim fails, and the page says why.
  await s.page.fill("#h0-input", "4421400");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
  assert.match(await text(s.page, "#verdict-sub"), /claim #12 \(control\): The challenge transaction 10e941e7…6e43 was mined at height 4421345, before you issued the nonce at height 4421400/);
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "match-unverified");
  assert.match(await text(s.page, "#nonce-line"), /but it did not verify: The challenge transaction .* before you issued the nonce at height 4421400/);
  await s.page.click("#copy-challenge");
  await s.page.waitForFunction(() => /Challenge copied/.test(document.getElementById("copy-live").textContent));
  assert.match(await s.page.evaluate(() => navigator.clipboard.readText()), new RegExp(`^Zeceipt challenge \\(source-of-funds dossier\\)\\nNonce: ${NONCE}\\nIssued at height \\(H0\\): 4421400\\nRecorded: \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC .*\\nNetwork: Zcash testnet$`));
  // From a fresh page, the input card's link opens the exchange sample with its challenge in one click: green.
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  await s.page.click("#sample-challenge");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  await assertPrivate(s);
  await s.context.close();
});

test("case review: transactions loaded from files check the sample offline, with no lookup, saying inclusion was not checked; then online", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  await s.page.setInputFiles("#tx-files", [...FUNDS, CONTROL].map((t) => ({ name: `${t}.hex`, mimeType: "text/plain", buffer: Buffer.from(`${CHAIN[t]}\n`) })).concat([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]));
  await s.page.waitForFunction(() => /^5 transactions loaded/.test(document.getElementById("tx-files-status").textContent));
  assert.match(await text(s.page, "#tx-files-status"), /inclusion in the chain is not checked\. Skipped: notes\.txt: not named <txid>\.hex\.$/);
  await s.page.click("#sample");
  await caseShown(s.page);
  // Consistent with the files, not verified against the chain (E03): amber, and it never says "against the chain".
  assert.equal(await text(s.page, "#headline"), OFFLINE, "every claim is consistent with the files");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result partial");
  const sub = await text(s.page, "#verdict-sub");
  assert.match(sub, /^All 12 claims are consistent with the transaction files you loaded .* a holder can send fabricated files\. Load only files you fetched from a node yourself, or check online\. Also, the claims do not explain all of the funds: origin n1 names no source: an undisclosed shielded sender\./);
  assert.ok(!/hold against the chain/.test(sub), sub);
  assert.equal(outside(s).length, 0, "no node was asked");
  assert.equal(await s.page.locator("#offline-line").isVisible(), true);
  assert.match(await text(s.page, "#offline-text"), /^Checked offline, from 5 transaction files: no node was asked, so inclusion in the chain \(and each height\) was not checked\.$/);
  assert.match((await dl(s.page, "#facts")).Checked, /UTC, offline, from 5 transaction files/);
  assert.match(await text(s.page, "#flow > li.step:first-child"), /Height unknown/);
  assert.match(await text(s.page, "#claims tbody tr:first-child"), /Loaded without a height \(from a file\): the inclusion of 90f6a335…2a4b, fcfde625…7f0b in the chain was not checked here\./);
  // Then online: the files are forgotten, and the same dossier is checked against the node.
  await s.page.click("#retry-online");
  await s.page.waitForFunction(() => /against zjs\.zec\.rocks\/testnet/.test(document.getElementById("facts").textContent));
  assert.equal(await s.page.locator("#offline-line").isVisible(), false);
  assert.equal(lookups(s).length, 5);
  assert.match(await text(s.page, "#flow > li.step:first-child"), /Height 4419987/);
  assert.equal(await text(s.page, "#headline"), PARTLY, "online, the same claims hold against the chain (and the faucet origin still names no source)");
  await assertPrivate(s);
  await s.context.close();
});

test("case review: #sample-transparent shows a payment out to a transparent address as a step, the funds returning from it, and both in the totals", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample-transparent`);
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "1 claim not proven", "n10 is not shown to be the holder's");
  assert.equal(await text(s.page, "#facts .fact-wide dd"), crypto.createHash("sha256").update(TRANSPARENT).digest("hex"));
  const steps = await s.page.locator("#flow > li.step").allTextContents();
  assert.equal(steps.length, 7);
  assert.match(steps[5], /Step 6Moved within the wallet, and paid out \(transparent\).*Height 4421678 · tx 52af3e0d…105e.*Paid out \(transparent\)#130\.05 TAZto tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu.*#13 Transparent paymentn5 → tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhuVerified/);
  assert.match(steps[6], /Step 7Origin: funds enter the holder's wallet.*returned from claim #13 \(paid by the holder\).*Not proven/);
  const row = await cells(s.page, "#claims tbody tr:nth-child(13)");
  assert.deepEqual(row.slice(0, 3), ["13", "Transparent payment", "Verified"]);
  assert.match(row[3], /^The holder paid 0\.05000000 TAZ to tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu \(transparent output 0\)/);
  assert.match(await text(s.page, "#funders"), /Origin of n10.*tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu.*returned from claim #13 \(paid by the holder\)/);
  const decision = await dl(s.page, "#decision");
  assert.match(decision["Arrived at origins"], /^1\.04985 TAZ in 2 notes/);
  assert.equal(decision["Paid out"], "0.11 TAZ in 4 payments3 shielded payments with a receipt (0.06 TAZ) and 1 transparent payment (0.05 TAZ).");
  assert.match(decision.Claims, /^14 verified · 1 not proven/);
  assert.equal(lookups(s).length, 7, "the seven transactions, the payment's and the return's among them");
  await assertPrivate(s, { extraSecrets: [b64(TRANSPARENT)] });
  await s.context.close();
});

test("case review: the exchange deposit review (#sample-exchange), with the exchange's challenge, is green: the hot wallet's withdrawal, the deposit back, control", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample-exchange`);
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTIAL, "amber until the exchange's nonce is given");
  assert.equal(await text(s.page, "#facts .fact-wide dd"), crypto.createHash("sha256").update(EXCHANGE_DOSSIER).digest("hex"));
  await s.page.click("#sample-nonce");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result ok");
  assert.deepEqual([await s.page.inputValue("#nonce-input"), await s.page.inputValue("#h0-input")], ["zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1", "4422294"]);
  assert.match(await text(s.page, "#verdict-sub"), /^All 4 claims hold against the chain \(1 origin, 1 path hop, 1 control answer and 1 transparent payment\), and the control claim answers the nonce you issued, after height 4422294/);
  assert.equal(await s.page.locator("#claims .badge-verified").count(), 4);
  const steps = await s.page.locator("#flow > li.step").allTextContents();
  assert.equal(steps.length, 3);
  assert.match(steps[0], /Origin: funds enter the holder's wallet.*Height 4422279.*From 1 transparent input \(0\.3 TAZ\), paid from tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv, of which 0\.09985 TAZ went back to tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv \(output 0\) as change to the funder\..*n10\.2 TAZ/);
  assert.match(steps[1], /Moved within the wallet, and paid out \(transparent\).*Height 4422295 · tx a51d1271…85cf.*Paid out \(transparent\)#30\.05 TAZto tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR/);
  assert.match(steps[2], /Control: the holder answered the challenge.*Height 4422305/);
  assert.match(await text(s.page, "#funders"), /Origin of n1.*tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv.*0\.3 TAZ, spends 773da014…4b0d:0.*Change: 0\.09985 TAZ of the inputs went back to tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv \(output 0\), the funder's own address; the holder received 0\.2 TAZ in n1\./);
  const decision = await dl(s.page, "#decision");
  assert.equal(decision["Paid out"], "0.05 TAZ in 1 payment1 transparent payment (0.05 TAZ).");
  assert.equal(decision["Under control"], "0.14985 TAZn2, spent in answer to your nonce at height 4422305 (issued at height 4422294).");
  // The four transactions, the hot wallet's funding second round; the challenge was applied with no new lookup.
  assert.deepEqual(lookups(s).map((r) => requestedTxid(Buffer.from(r.body, "latin1"))).sort(), Object.keys(EXCHANGE).sort());
  // The flagship button on the input card opens the same review.
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  await s.page.click("#sample-exchange");
  await caseShown(s.page);
  assert.equal(await s.page.locator("#claims tbody tr").count(), 4);
  await assertPrivate(s, { extraSecrets: [b64(EXCHANGE_DOSSIER), "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1"] });
  await s.context.close();
});

test("build: the published testnet UFVK and the txids rebuild the sample's claims; the key field is cleared and never sent", { skip: !RUN }, async () => {
  const s = await openPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  assert.match(await text(s.page, ".promise h2"), /Your viewing key stays in this page/);
  assert.deepEqual(await s.page.$eval("#ufvk", (e) => [e.getAttribute("autocomplete"), e.getAttribute("spellcheck")]), ["off", "false"]);
  assert.equal(await s.page.inputValue("#network"), "main");
  await s.page.fill("#ufvk", UFVK);
  assert.equal(await s.page.inputValue("#network"), "test", "the network follows the key's prefix");
  assert.equal(await text(s.page, "#ufvk-network"), "Network set from the key: Zcash testnet.");
  await s.page.waitForSelector("#wasm-sha:not([hidden])");
  assert.equal(await text(s.page, "#wasm-sha"), `Verifier: zeceipt_wasm_bg.wasm sha256 ${WASM_SHA}`);
  // In any order: the builder puts each transaction after those whose notes it spends (the origin is listed second).
  const listed = [FUNDS[1], FUNDS[0], FUNDS[2], FUNDS[3]];
  await s.page.fill("#txids", listed.join("\n"));
  await s.page.fill("#nonce", NONCE);
  await s.page.fill("#control-txid", CONTROL);
  await s.page.click("#build");
  await s.page.waitForSelector("#built:not([hidden])");
  assert.equal(await s.page.inputValue("#ufvk"), "", "the key field is cleared once built");
  assert.equal(await text(s.page, "#built-title"), "Dossier built");
  // The faucet's payment names no source (an undisclosed shielded sender): the holder is told before sharing.
  assert.equal(await s.page.getAttribute("#built", "class"), "result pending");
  assert.equal(await text(s.page, "#built-sub"), "12 claims, all verified in this page against the chain: 1 origin, 7 path hops, 3 deposits and 1 control answer. But they do not explain all of the funds (origin n1 names no source: an undisclosed shielded sender): the reviewer will see “funds not fully explained”. The chain shows no source for n1: be ready to tell the reviewer who sent it, with your evidence. The viewing key field was cleared.");
  assert.equal(await s.page.evaluate(() => document.activeElement?.id), "built");
  assert.deepEqual(await dl(s.page, "#built-counts"), { Notes: "9", Receipts: "3", Claims: "12 (1 origin, 7 path hops, 3 deposits and 1 control answer)" });
  assert.match(await text(s.page, "#built-discloses"), /^nk, the nullifier key.*see when any of these notes is spent, past and future.*anyone who ever paid you and obtains this nk.*9 note openings.*3 sender receipts/);
  assert.match(await text(s.page, "#built"), /After the case: the nk in this dossier stays with the reviewer.*anyone who ever paid you \(an exchange that sent withdrawals to you, for example\), can use it to see when every note they paid you is spent, past and future, not only the disclosed ones\. Once the case is closed, move the remaining funds to a fresh account/);
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
  assert.deepEqual(asked, [...listed, CONTROL]);
  // The review link carries the dossier in its fragment; Open in Case review follows it and checks it.
  await s.page.click("#copy-link");
  await s.page.waitForFunction(() => /Review link copied/.test(document.getElementById("link-status").textContent));
  const link = await s.page.evaluate(() => navigator.clipboard.readText());
  assert.equal(link, `${base}/case/#${b64(builtText)}`);
  assert.equal(await s.page.getAttribute("#open-case", "href"), link);
  await assertPrivate(s, { extraSecrets: [b64(builtText)] });
  await s.page.click("#open-case");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "not-generated");
  await assertPrivate(s, { extraSecrets: [b64(builtText)] });
  await s.context.close();
});

test("build: Find my transactions scans compact blocks in the page and lists the holder's seven transactions, oldest first; the key never leaves", { skip: !RUN }, async () => {
  // The node: its tip, and GetBlockRange answering with the real compact blocks it served on 2026-09-30 (fixtures).
  const blocks = JSON.parse(read(path.join(repo, "fixtures/testnet/compact-blocks.json"))).blocks;
  const TIP = 4421700;
  const readVarint = (b, i) => { let v = 0n, s = 0n; for (;;) { const x = b[i++]; v |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return [Number(v), i]; s += 7n; } };
  const range = (body) => {
    // BlockRange { start: BlockID { height = 1 } = 1, end: BlockID = 2 }, after the 5-byte gRPC-web frame header.
    const b = body.subarray(5), out = [];
    for (let i = 0; i < b.length;) { const [, i1] = readVarint(b, i); const [len, i2] = readVarint(b, i1); const [h] = readVarint(b, i2 + 1); out.push(h); i = i2 + len; }
    return out;
  };
  const s = await openPage();
  const asked = [];
  await s.context.route("https://zjs.zec.rocks/testnet/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/GetLatestBlock")) return route.fulfill({ status: 200, headers: grpcHeaders, body: Buffer.concat([frame(0, [0x08, ...varintBytes(TIP)]), frame(0x80, Buffer.from("grpc-status:0\r\n"))]) });
    if (url.endsWith("/GetBlockRange")) {
      const [start, end] = range(route.request().postDataBuffer());
      asked.push([start, end]);
      const frames = Object.entries(blocks).filter(([h]) => +h >= start && +h <= end).map(([, b]) => frame(0, Buffer.from(b, "base64")));
      return route.fulfill({ status: 200, headers: grpcHeaders, body: Buffer.concat([...frames, frame(0x80, Buffer.from("grpc-status:0\r\n"))]) });
    }
    return route.fulfill({ status: 200, headers: grpcHeaders, body: nodeAnswer(requestedTxid(route.request().postDataBuffer())) });
  });
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  await s.page.selectOption("#network", "test");
  await s.page.fill("#ufvk", UFVK);
  await s.page.fill("#scan-from", "4419900");
  await s.page.click("#scan");
  await s.page.waitForFunction(() => /^Found \d+ transactions? of yours/.test(document.getElementById("scan-status").textContent), null, { timeout: 30_000 });
  assert.match(await text(s.page, "#scan-status"), /^Found 7 transactions of yours in [\d.]+ s; 7 listed above\. If one of them answers a reviewer's challenge, Build says so and moves it under Control in one click\.$/);
  const listed = (await s.page.inputValue("#txids")).split("\n");
  assert.deepEqual(listed, [...FUNDS, CONTROL, "52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e", "c28b60004cd8d9fc08ab75ff44aa3062a4d79bdfc29653db8765991b5ae5cefe"]);
  assert.deepEqual(asked, [[4419900, 4421700]], "one request of at most 2,000 blocks, up to the tip");
  // With the challenge transaction entered, the scan leaves it out of the list.
  await s.page.fill("#control-txid", CONTROL);
  await s.page.click("#scan");
  await s.page.waitForFunction(() => /the challenge transaction is entered below/.test(document.getElementById("scan-status").textContent), null, { timeout: 30_000 });
  assert.ok(!(await s.page.inputValue("#txids")).includes(CONTROL));
  // The UFVK is in no request (the scan sends heights only).
  for (const r of s.requests) assert.ok(!r.body.includes(UFVK) && !r.url.includes(UFVK) && !r.headers.includes(UFVK), `a request carried the UFVK: ${r.url}`);
  await s.context.close();
});

test("build: a network mismatch, bad hex and a key that sees nothing are each explained; Forget everything clears the page", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  // The network follows the key; a holder who then picks another is told, before anything is fetched.
  await s.page.fill("#ufvk", UFVK);
  assert.equal(await s.page.inputValue("#network"), "test");
  await s.page.selectOption("#network", "main");
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

// RFC 6902 add, replace and remove, as test/dossier-vectors.mjs applies the vectors' patches.
function applyPatch(doc, patch) {
  for (const op of patch) {
    const keys = op.path.slice(1).split("/");
    const last = keys.pop();
    let at = doc;
    for (const k of keys) at = at[Array.isArray(at) ? Number(k) : k];
    if (op.op === "remove") Array.isArray(at) ? at.splice(Number(last), 1) : delete at[last];
    else if (op.op === "add" && Array.isArray(at)) last === "-" ? at.push(op.value) : at.splice(Number(last), 0, op.value);
    else at[Array.isArray(at) ? Number(last) : last] = op.value;
  }
  return doc;
}
const vectorDossier = (name) => JSON.stringify(applyPatch(JSON.parse(SAMPLE), VECTORS.cases.find((c) => c.name === name).patch), null, 2);

test("case review: claims that do not add up are amber, funds not fully explained: the untraced note and the undisclosed value in the verdict, the rows and the timeline", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  // Vector unlinked_payment: the path n1→n3 removed, so n3's payments no longer trace back to the origin.
  const unlinked = vectorDossier("unlinked_payment");
  await s.page.fill("#paste", unlinked);
  await s.page.click("#check");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await s.page.getAttribute("#banner", "class"), "result partial");
  assert.match(await text(s.page, "#verdict-sub"), /^All 11 claims hold against the chain .*, but they do not explain all of the funds: note n3 is not traced back to an origin/);
  assert.match((await dl(s.page, "#decision")).Explained, /^NoNote n3 is not traced back to an origin/);
  assert.ok((await s.page.locator("#claims .row-flag.flag-warn").allTextContents()).some((t) => /^Not traced to an origin: n3/.test(t)));
  assert.ok(await s.page.locator("#flow .chip-untraced").count() >= 1);
  assert.match(await text(s.page, "#flow"), /n3 not traced to an origin/);
  // Vector history_without_its_origin: a deposit whose transaction spent 1 TAZ of notes the dossier does not disclose.
  const hidden = vectorDossier("history_without_its_origin");
  await s.page.click("#inputs > summary");
  await s.page.fill("#paste", hidden);
  await s.page.click("#check");
  await s.page.waitForFunction(() => /at least 1\.0 TAZ came from notes/.test(document.getElementById("verdict-sub").textContent));
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await text(s.page, "#claims tbody tr:first-child .row-flag"), "Not fully explained: at least 1.0 TAZ of what this transaction paid came from notes the dossier does not disclose.");
  assert.match(await text(s.page, "#flow"), /Not fully explained: this transaction also spent at least 1\.0 TAZ from notes the dossier does not disclose\./);
  await axe(s.page, "case, funds not fully explained");
  await assertPrivate(s, { extraSecrets: [b64(unlinked), b64(hidden)] });
  await s.context.close();
});

test("case review: the dossier's nonce is kept back until the reviewer's matches; a typed match gets a neutral note, a generated or sample one none", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample-exchange`);
  await caseShown(s.page);
  const own = "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1";
  assert.match(await text(s.page, "#nonce-line"), /answers a nonce beginning zeceipt-challenge-322b…\. Enter the nonce you issued .*paste it from your case record, not from this page/);
  assert.match(await text(s.page, "#nonce-hint"), /^Paste it from your case record, not from this page\./);
  assert.ok(!(await s.page.evaluate(() => document.body.innerText)).includes(own), "the whole nonce is nowhere to copy");
  // Typed (or pasted) and equal to the dossier's: green, with a neutral reminder.
  await s.page.fill("#nonce-input", own);
  await s.page.fill("#h0-input", "4422294");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  assert.equal(await s.page.locator("#nonce-note").isVisible(), true);
  assert.equal(await text(s.page, "#nonce-note"), "You entered this nonce, rather than generating it here: make sure this is the one you sent to the holder, from your case record.");
  assert.match(await text(s.page, "#claims tbody tr:last-child"), new RegExp(own), "once it matches, the claim reads in full");
  // The page's sample challenge is ours: no reminder.
  await s.page.click("#nonce-input", { clickCount: 3 });
  await s.page.keyboard.press("Backspace");
  await s.page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "not-generated");
  assert.equal(await s.page.locator("#nonce-note").isVisible(), false);
  await s.page.click("#sample-nonce");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  assert.equal(await s.page.locator("#nonce-note").isVisible(), false);
  await assertPrivate(s, { extraSecrets: [b64(EXCHANGE_DOSSIER), own] });
  await s.context.close();
});

test("case review: the deposit address the reviewer assigned, checked by the verifier, is named when a payment pays it; when none does the case is not verified (red), with the relay explained in amber, in the challenge record and in print", { skip: !RUN }, async () => {
  const s = await openPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await s.page.goto(`${base}/case/#sample-exchange`);
  await caseShown(s.page);
  await s.page.click("#sample-nonce");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  await s.page.fill("#deposit-input", "tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR");
  await s.page.waitForFunction(() => /pays the deposit address you assigned/.test(document.getElementById("verdict-sub").textContent));
  assert.equal(await text(s.page, "#deposit-status"), "A transparent address on Zcash testnet.");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result ok");
  assert.match(await text(s.page, "#verdict-sub"), /Claim #3 \(transparent payment\) pays the deposit address you assigned \(tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR\)/);
  assert.equal(await s.page.locator("#deposit-line").isVisible(), false);
  assert.equal(await text(s.page, "#claims tbody tr:nth-child(3) .row-flag.flag-ok"), "Pays the deposit address you assigned.");
  assert.match(await text(s.page, "#flow .chip-assigned"), /pays the deposit address you assigned/);
  assert.equal((await dl(s.page, "#facts"))["Deposit address you assigned"], "tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR (paid in claim #3)");
  // An address no payment pays (here the hot wallet's): the verifier makes it a problem, so the case is not verified:
  // red, with its words, and the amber line naming the relay the check guards against.
  await s.page.fill("#deposit-input", "tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv");
  await s.page.waitForSelector("#deposit-line:not([hidden])");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Deposit address not paid");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result bad");
  assert.equal(await text(s.page, "#verdict-sub"), "No verified payment in this dossier pays the deposit address you assigned (tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv): it does not show that this holder made your deposit. All 4 claims verify against the chain, but nothing ties these funds to the customer you assigned that address to.");
  assert.equal(await s.page.locator("#banner-error").isVisible(), false, "the verifier's problem is said once, in the verdict");
  assert.match(await text(s.page, "#deposit-line"), /^No verified payment in this dossier pays the deposit address you assigned \(tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv\).*relayed.*spec §7\.2/);
  assert.equal(await s.page.locator("#claims .row-flag.flag-ok").count(), 0, "no row is flagged as paying it");
  assert.equal((await dl(s.page, "#facts"))["Deposit address you assigned"], "tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv (no verified payment pays it)");
  assert.equal(lookups(s).length, 4, "checked again with the transactions already fetched");
  await s.page.click("#copy-challenge");
  await s.page.waitForFunction(() => /Challenge copied/.test(document.getElementById("copy-live").textContent));
  assert.match(await s.page.evaluate(() => navigator.clipboard.readText()), /\nDeposit address assigned: tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv$/);
  await s.page.emulateMedia({ media: "print" });
  assert.equal(await s.page.locator("#deposit-line").isVisible(), true, "the amber line prints");
  assert.equal(await s.page.locator('#facts .fact[data-key="Deposit address you assigned"]').isVisible(), true, "the address prints with the facts");
  await s.page.emulateMedia({ media: "screen" });
  await axe(s.page, "case, the assigned deposit address not paid");
  // A mainnet address for this testnet dossier: another network, red.
  await s.page.fill("#deposit-input", "t1Xf8t29nJhQbPpqzfg2gzSLZNjjQVYwGQr");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Deposit address for another network");
  assert.equal(await text(s.page, "#deposit-status"), "A transparent address on Zcash mainnet.");
  assert.match(await text(s.page, "#verdict-sub"), /^The deposit address you gave \(t1Xf8t29nJhQbPpqzfg2gzSLZNjjQVYwGQr\) is for another network than this dossier \(testnet\)\./);
  // The same address in its TEX form (ZIP 320): paid, green again.
  await s.page.fill("#deposit-input", "textest17pl2ywthp96lyt8qwhn0mjx5clrtclw7092g5y");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  assert.equal(await text(s.page, "#deposit-status"), "A TEX (ZIP 320) address on Zcash testnet.");
  assert.equal(await text(s.page, "#claims tbody tr:nth-child(3) .row-flag.flag-ok"), "Pays the deposit address you assigned.");
  // Not an address: said, and left out of the check.
  await s.page.fill("#deposit-input", "utest1notanaddress");
  await s.page.waitForFunction(() => /not a transparent address/.test(document.getElementById("deposit-status").textContent));
  await s.page.waitForSelector("#deposit-line", { state: "hidden" });
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
  await assertPrivate(s, { extraSecrets: [b64(EXCHANGE_DOSSIER)] });
  await s.context.close();
});

test("case review: the laundering patch (vector origin_laundering) is amber: the holder's own change declared an origin names no source, in the verdict, the Explained line, the row and the timeline", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  const laundered = vectorDossier("origin_laundering");
  await s.page.fill("#nonce-input", NONCE);
  await s.page.fill("#h0-input", "4421300");
  await s.page.fill("#paste", laundered);
  await s.page.click("#check");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTLY);
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "match", "control is shown, and does not make up for the funds");
  assert.match(await text(s.page, "#verdict-sub"), /^All 2 claims hold against the chain \(1 origin and 1 control answer\), but they do not explain all of the funds: note n4 is not traced back to an origin .* and origin n2 names no source: it spends disclosed notes \(n1\), so it is a hop, not a source\. Ask the holder for the missing history/);
  assert.equal((await dl(s.page, "#decision")).Explained, "NoNote n4 is not traced back to an origin (no chain of path claims leads from an origin claim to it) and origin n2 names no source: it spends disclosed notes (n1), so it is a hop, not a source.");
  assert.equal(await text(s.page, "#claims tbody tr:first-child .row-flag"), "Names no source: it spends disclosed notes (n1), so it is a hop, not a source. The funds of n2 are not explained by this dossier.");
  assert.match(await text(s.page, "#flow > li.step:first-child"), /Origin: funds enter the holder's wallet.*n2.*names no source.*Origin n2 names no source: it spends disclosed notes \(n1\), so it is a hop, not a source: this dossier does not explain where these funds came from\./);
  await axe(s.page, "case, an origin that names no source");
  await assertPrivate(s, { extraSecrets: [b64(laundered)] });
  await s.context.close();
});

test("case review: #sample-beacon looks up the block its control answers and is green with no nonce entered; the beacon is shown whole, and the verdict names the block", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample-beacon`);
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), "Verified, with control");
  assert.equal(await s.page.getAttribute("#banner", "class"), "result ok");
  assert.equal(await text(s.page, "#verdict-sub"), "All 6 claims hold against the chain (1 origin, 3 path hops, 1 control answer and 1 transparent payment), and the control claim answers the hash of block 4426425 (mined 2026-10-01 06:49 UTC), a beacon no one could know before that block: the holder could spend these funds after it was mined. No one issued this nonce: judge whether block 4426425 is recent enough for this case.");
  const said = "This control answers the hash of block 4426425 (time 2026-10-01 06:49 UTC): no nonce needs to be entered; judge whether block 4426425 is recent enough.";
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "beacon");
  assert.equal(await text(s.page, "#nonce-line"), said);
  assert.equal(await text(s.page, "#nonce-result"), said, "the challenge card says so too");
  assert.equal(await s.page.inputValue("#nonce-input"), "", "no nonce was entered");
  assert.equal(await s.page.locator("#sample-nonce-row").isVisible(), false, "no sample challenge to fill in");
  assert.ok((await s.page.evaluate(() => document.body.innerText)).includes(BEACON_NONCE), "a beacon is public: shown whole");
  assert.equal((await dl(s.page, "#facts"))["Control answers the beacon of"], "block 4426425 (mined 2026-10-01 06:49 UTC), hash 00000f97…4b7f");
  assert.equal((await dl(s.page, "#decision"))["Under control"], "0.14975 TAZn3, n4, spent in answer to the beacon of block 4426425 (mined 2026-10-01 06:49 UTC) at height 4426430: no one issued the nonce; judge whether that block is recent enough.");
  assert.match(await text(s.page, "#flow > li.step:last-child"), new RegExp(`Control: the holder answered the challenge.*Height 4426430.*memo “${BEACON_NONCE}”`));
  assert.deepEqual(blockLookups(s), [BEACON_BLOCK.height], "the one block the beacon names, asked by its height");
  assert.deepEqual(lookups(s).map((r) => requestedTxid(Buffer.from(r.body, "latin1"))).sort(), [...Object.keys(EXCHANGE), BEACON_TX].sort());
  // The deposit address the customer was assigned: the core finds it paid (PROOF §10).
  await s.page.fill("#deposit-input", "tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR");
  await s.page.waitForFunction(() => /pays the deposit address you assigned/.test(document.getElementById("verdict-sub").textContent));
  assert.equal(await s.page.getAttribute("#banner", "class"), "result ok");
  assert.deepEqual(blockLookups(s), [BEACON_BLOCK.height], "checked again with the block already looked up");
  // A reviewer's own nonce overrides the beacon: the claim must answer theirs.
  await s.page.fill("#nonce-input", "zeceipt-challenge-00000000000000000000000000000000");
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
  assert.match(await text(s.page, "#nonce-line"), new RegExp(`answers the beacon ${BEACON_NONCE}, not the nonce you issued`));
  // Offline, from files: no node is asked, not even for the block, so the control is not checked.
  await s.page.fill("#nonce-input", "");
  await s.page.setInputFiles("#tx-files", [...Object.keys(EXCHANGE), BEACON_TX].map((t) => ({ name: `${t}.hex`, mimeType: "text/plain", buffer: Buffer.from(CHAIN[t]) })));
  await s.page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "beacon-unchecked");
  assert.equal(await text(s.page, "#headline"), "Not all checked");
  assert.match(await text(s.page, "#nonce-line"), /^This control answers the hash of block 4426425: no nonce needs to be entered, but it is not checked here: /);
  assert.deepEqual(blockLookups(s), [BEACON_BLOCK.height], "offline, the block is not asked again");
  await axe(s.page, "case, a beacon control not checked offline");
  await assertPrivate(s, { extraSecrets: [b64(BEACON_DOSSIER)] });
  await s.context.close();
});

test("case review: Generate a beacon nonce asks the node for the tip and its block, and fills zeceipt-beacon-<tip>-<hash> with H₀ the next height", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/`);
  await ready(s.page);
  await s.page.selectOption("#challenge-network", "test");
  await s.page.click("#beacon-new");
  await s.page.waitForFunction(() => /^A beacon/.test(document.getElementById("h0-status").textContent));
  const tip = blockId(TIPS.test);
  assert.equal(await s.page.inputValue("#nonce-input"), `zeceipt-beacon-${TIPS.test}-${tip.hash}`);
  assert.equal(await s.page.inputValue("#h0-input"), String(TIPS.test + 1));
  assert.match(await text(s.page, "#h0-status"), new RegExp(`^A beacon: the hash of block ${TIPS.test} on Zcash testnet, mined \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC\\. No one could know it before that block.*H₀ is ${TIPS.test + 1}`));
  assert.equal(await text(s.page, "#copy-live"), "Beacon nonce generated");
  assert.deepEqual(outside(s).map((r) => r.url.replace(/^.*\//, "")), ["GetLatestBlock", "GetBlock"]);
  assert.deepEqual(blockLookups(s), [TIPS.test]);
  // The holder's beacon sample answers another block's beacon: with this one expected, its control fails.
  await s.page.goto(`${base}/case/#sample-beacon`);
  await caseShown(s.page);
  await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
  assert.equal(await s.page.getAttribute("#nonce-line", "data-state"), "mismatch");
  assert.equal(await s.page.locator("#nonce-note").isVisible(), false, "generated here: no reminder to check it");
  await assertPrivate(s, { extraSecrets: [b64(BEACON_DOSSIER)] });
  await s.context.close();
});

test("build: “or use a beacon” fills the latest block's beacon as the control nonce, for a holder proving control unprompted", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  await s.page.selectOption("#network", "test");
  assert.equal(await text(s.page, "#beacon"), "or use a beacon (the latest block's hash)");
  await s.page.click("#beacon");
  await s.page.waitForFunction(() => /^The beacon of block/.test(document.getElementById("beacon-status").textContent));
  assert.equal(await s.page.inputValue("#nonce"), `zeceipt-beacon-${TIPS.test}-${blockId(TIPS.test).hash}`);
  assert.match(await text(s.page, "#beacon-status"), /^The beacon of block 4,421,700 \(Zcash testnet, mined .* UTC\) is filled in above\. Send any small amount to your own address with it as the memo/);
  assert.deepEqual(outside(s).map((r) => r.url.replace(/^.*\//, "")), ["GetLatestBlock", "GetBlock"]);
  await axe(s.page, "build, a beacon filled in");
  await s.page.click("#forget");
  assert.equal(await s.page.inputValue("#nonce"), "");
  assert.equal(await text(s.page, "#beacon-status"), "");
  await assertPrivate(s);
  await s.context.close();
});

test("case review: Hide nullifiers leaves them out of the downloaded report and says so; a printout never shows them", { skip: !RUN }, async () => {
  const s = await openPage();
  await s.page.goto(`${base}/case/#sample`);
  await caseShown(s.page);
  const [full] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  const withNf = JSON.parse(fs.readFileSync(await full.path(), "utf8"));
  assert.ok(Object.values(withNf.notes).every((n) => /^[0-9a-f]{64}$/.test(n.nullifier)), "by default the report is the verifier's, nullifiers included");
  await s.page.check("#hide-nullifiers");
  const [redacted] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  const raw = fs.readFileSync(await redacted.path(), "utf8");
  const without = JSON.parse(raw);
  assert.ok(!raw.includes('"nullifier"') && Object.values(withNf.notes).every((n) => !raw.includes(n.nullifier)));
  assert.match(without.case.nullifiers, /^left out of this file \(notes\.\*\.nullifier\)/);
  assert.equal(without.dossier_sha256, withNf.dossier_sha256);
  assert.match(await text(s.page, "#copy-live"), /without the notes' nullifiers$/);
  await s.page.emulateMedia({ media: "print" });
  const printed = await s.page.evaluate(() => document.body.innerText);
  assert.ok(Object.values(withNf.notes).every((n) => !printed.includes(n.nullifier)));
  assert.match(await text(s.page, "#print-meta"), /The notes' nullifiers are not printed\.$/);
  await assertPrivate(s);
  await s.context.close();
});

test("build: the sample customer's key fills the form; a listed challenge answer is refused, and one click moves it under Control and builds the exchange sample", { skip: !RUN }, async () => {
  const HOLDER2 = read(path.join(repo, "fixtures/testnet/holder2-ufvk.txt")).trim();
  const [origin, deposit, challenge] = ["5146f38c0a782f0d76858e575c46c3b0908865987416095e4180a2c6273436e6", "a51d12711cd68729699ee93ea3e466bfb0222c7f3a02c2f64bd3b66ed60985cf", "14a9551d4b85b05ce48dc6e83784bdb8bad0a68b6ec2a5e2298b2f77bb79cce6"];
  const s = await openPage();
  await s.page.goto(`${base}/build/`);
  await ready(s.page);
  assert.match(await text(s.page, ".nu7"), /NU7 activates on Zcash testnet on 2026-10-06 .* refuses a transaction mined after activation/);
  await s.page.click("#sample-key");
  assert.equal(await s.page.inputValue("#ufvk"), HOLDER2);
  assert.equal(await s.page.inputValue("#network"), "test", "the network follows the sample key");
  assert.equal(await s.page.inputValue("#scan-from"), "4422270");
  assert.match(await text(s.page, "#sample-key-status"), /sample customer's testnet viewing key \(public, fixtures\/testnet\/holder2-ufvk\.txt\).*4,422,270/);
  // As the scan lists them: the challenge answer among the funds, and nothing under Control.
  await s.page.fill("#txids", [origin, deposit, challenge].join("\n"));
  await s.page.click("#build");
  await s.page.waitForSelector("#build-error:not([hidden])");
  assert.match(await text(s.page, "#error-text"), /^Transaction 14a9551d…cce6 answers a reviewer's challenge \(its memo reads “zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1”\)\. A challenge answer goes under Control/);
  assert.equal(await text(s.page, "#error-fix-btn"), "Move it to Control and build again");
  await axe(s.page, "build, a listed challenge answer");
  await s.page.click("#error-fix-btn");
  await s.page.waitForSelector("#built:not([hidden])");
  assert.equal(await s.page.inputValue("#control-txid"), challenge);
  assert.equal(await s.page.inputValue("#nonce"), "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1");
  assert.equal(await s.page.inputValue("#txids"), [origin, deposit].join("\n"));
  assert.match(await text(s.page, "#control-note"), /^14a9551d…cce6 was moved from the list to Control, with the nonce its memo carries \(zeceipt-challenge-322b…\)/);
  assert.equal(await s.page.getAttribute("#built", "class"), "result ok");
  const [saved] = await Promise.all([s.page.waitForEvent("download"), s.page.click("#download")]);
  const built = JSON.parse(fs.readFileSync(await saved.path(), "utf8"));
  const x = JSON.parse(EXCHANGE_DOSSIER);
  assert.deepEqual([built.nk, built.notes, built.claims], [x.nk, x.notes, x.claims], "the exchange sample's claims: the change of the challenge is not disclosed");
  // Listing the challenge and entering it under Control too: it is taken out of the list, with a note.
  await s.page.click("#sample-key");
  await s.page.fill("#txids", [origin, deposit, challenge].join("\n"));
  await s.page.click("#build");
  await s.page.waitForSelector("#built:not([hidden])");
  assert.match(await text(s.page, "#control-note"), /^The challenge transaction 14a9551d…cce6 was also in the list: it was taken out, and is used only under Control\.$/);
  assert.equal(await s.page.inputValue("#txids"), [origin, deposit].join("\n"));
  await assertPrivate(s, { extraSecrets: [HOLDER2, HOLDER2.slice(30, 90)] });
  await s.context.close();
});

test("the built site (scripts/build_site.sh): every module and the wasm load by versioned URLs, and the flagship sample checks", { skip: !RUN }, async () => {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "zeceipt-e2e-site-"));
  execFileSync(path.join(repo, "scripts/build_site.sh"), [out], { stdio: "pipe" });
  const site = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(out, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ""));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(out) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const siteBase = `http://127.0.0.1:${site.address().port}`;
  try {
    const s = await openPage();
    await s.page.goto(`${siteBase}/case/#sample-exchange`);
    await caseShown(s.page);
    assert.equal(await text(s.page, "#headline"), PARTIAL);
    const assets = s.requests.filter((r) => r.url.startsWith(siteBase) && /\.(js|wasm|css)(\?|$)/.test(r.url));
    assert.ok(assets.some((r) => /\/pkg\/zeceipt_wasm_bg\.wasm\?v=[0-9a-f]{8}$/.test(r.url)), "the wasm by its version");
    assert.deepEqual(assets.filter((r) => !/\?v=[0-9a-f]{8}$/.test(r.url)).map((r) => r.url), [], "no asset without its version");
    await s.page.waitForSelector("#wasm-sha:not([hidden])");
    assert.equal(await text(s.page, "#wasm-sha"), `Verifier: zeceipt_wasm_bg.wasm sha256 ${WASM_SHA}`, "the same bytes as the committed wasm");
    await s.context.close();
  } finally {
    await new Promise((r) => site.close(r));
    fs.rmSync(out, { recursive: true, force: true });
  }
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
  assert.ok(hrefs.includes(`${base}/case/`) && hrefs.includes(`${base}/build/`) && hrefs.includes(`${base}/case/#sample-exchange`) && hrefs.includes(`${base}/r/`) && hrefs.includes(`${base}/demo/`));
  assert.match(await text(s.page, ".try"), /a simulated exchange-deposit review on testnet \(we ran the exchange's wallet\)/);
  await s.page.click("text=Try an exchange deposit review");
  await caseShown(s.page);
  assert.equal(await text(s.page, "#headline"), PARTIAL);
  assert.equal(await s.page.locator("#claims tbody tr").count(), 4, "the exchange review's four claims");
  await assertPrivate(s, { extraSecrets: [b64(EXCHANGE_DOSSIER)] });
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
    await axe(s.page, `${colorScheme}: case, all verified, an origin that names no source`);
    await s.page.click("#sample-nonce");
    await s.page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "match");
    await axe(s.page, `${colorScheme}: case, control shown, funds not fully explained`);
    for (const id of ["nonce-input", "h0-input"]) await s.page.fill(`#${id}`, "");
    await s.page.goto(`${base}/case/#sample-exchange`);
    await s.page.waitForFunction((h) => document.getElementById("claims").tBodies[0].rows.length === 4 && document.getElementById("headline").textContent === h, PARTIAL);
    await s.page.click("#sample-nonce");
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Verified, with control");
    await s.page.click("#glossary > summary");
    await axe(s.page, `${colorScheme}: case, verified with control, glossary open`);
    for (const id of ["nonce-input", "h0-input"]) await s.page.fill(`#${id}`, "");
    await s.page.goto(`${base}/case/#sample-beacon`);
    await s.page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "beacon");
    await axe(s.page, `${colorScheme}: case, a beacon control`);
    await s.page.click("#inputs > summary");
    await s.page.setInputFiles("#file", { name: "dossier.json", mimeType: "application/json", buffer: Buffer.from(TAMPERED) });
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
    await axe(s.page, `${colorScheme}: case, a claim failed`);
    await s.page.click("#inputs > summary");
    await s.page.fill("#paste", "{not a dossier");
    await s.page.click("#check");
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "Not a readable dossier");
    await axe(s.page, `${colorScheme}: case, unreadable`);
    await s.page.goto(`${base}/case/#sample-transparent`);
    await s.page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim not proven");
    await axe(s.page, `${colorScheme}: case, the transparent sample`);
    await s.page.goto(`${base}/build/`);
    await ready(s.page);
    await axe(s.page, `${colorScheme}: build, empty`);
    await s.page.fill("#ufvk", UFVK);
    await s.page.selectOption("#network", "main"); // against the key's network: a mismatch
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
