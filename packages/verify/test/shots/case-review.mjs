// The README's hero images: the case review page (case/) on the committed testnet sample dossier, checked as its
// reviewer would (with the nonce the sample answered and its H₀: control shown, and amber, "Claims verified — funds not
// fully explained", since round 3: its faucet origin is an undisclosed shielded sender), as a reviewer first sees
// the result (the page scrolls to the verdict, with the funds-flow timeline under
// it), at 1280 px wide and 2x, light and dark. Usage: node test/shots/case-review.mjs [out-dir]
// (default docs/assets: case-review.png, case-review-dark.png).
// The testnet node is simulated as in dossier.e2e.mjs, serving the sample's real transactions (fixtures/testnet/) at
// the heights the live node reported, so no network is needed; ZECEIPT_SHOT_URL=<a site's base URL, e.g.
// https://beautifulremi.dpdns.org/zeceipt/> shoots that site as it is, asking the real node. ZECEIPT_SHOT_PAGES=1 also
// writes the review set into the same directory: the whole case page (light, dark, phone), a failed case, the
// builder before and after building, the landing page, and the printed case report (PDF).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const repo = path.join(root, "..", "..");
const outDir = process.argv[2] ?? path.join(repo, "docs", "assets");
fs.mkdirSync(outDir, { recursive: true });
const read = (p) => fs.readFileSync(p, "utf8");
const FIXTURES = path.join(repo, "fixtures", "testnet");
const HEIGHTS = { "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b": 4419987, fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b: 4420000, "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d": 4420003, a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8: 4420005, "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43": 4421345 };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const live = process.env.ZECEIPT_SHOT_URL;
const base = live ? live.replace(/\/?$/, "/") : `http://127.0.0.1:${server.address().port}/`;

const varint = (n) => { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const frame = (flag, b) => { const f = Buffer.alloc(5 + b.length); f[0] = flag; f.writeUInt32BE(b.length, 1); Buffer.from(b).copy(f, 5); return f; };
const headers = { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
function node(route) {
  const url = route.request().url();
  if (!url.startsWith("https://zjs.zec.rocks/testnet/")) return route.abort();
  const txid = Buffer.from(route.request().postDataBuffer().subarray(7, 39)).reverse().toString("hex");
  const f = path.join(FIXTURES, `${txid}.hex`);
  if (!fs.existsSync(f)) return route.fulfill({ status: 200, headers, body: Buffer.concat([frame(0, []), frame(0x80, Buffer.from("grpc-status:5\r\ngrpc-message:not found\r\n"))]) });
  const data = Buffer.from(read(f).trim(), "hex");
  return route.fulfill({ status: 200, headers, body: Buffer.concat([frame(0, [0x0a, ...varint(data.length), ...data, 0x10, ...varint(HEIGHTS[txid] ?? 4420000)]), frame(0x80, Buffer.from("grpc-status:0\r\n"))]) });
}

const browser = await chromium.launch({ channel: "chrome", args: ["--lang=en-US"] });
async function open(scheme, width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: "en-US", colorScheme: scheme, reducedMotion: "reduce" });
  if (!live) await context.route("https://**/*", node);
  const page = await context.newPage();
  return { context, page };
}
const verified = (page) => page.waitForFunction(() => !document.getElementById("banner").hidden && /verified|failed|checked/.test(document.getElementById("headline").textContent), null, { timeout: 120_000 });
/** The sample checked with the challenge it answered (a site without the button is shot as it is). */
async function withChallenge(page) {
  if (!(await page.locator("#sample-nonce").isVisible())) return;
  await page.click("#sample-nonce");
  await page.waitForFunction(() => document.getElementById("nonce-line").dataset.state === "match");
  await page.evaluate(() => document.getElementById("banner").scrollIntoView({ block: "start" }));
}
const written = [];
const shot = async (page, name, opts = {}) => { const p = path.join(outDir, name); await page.screenshot({ path: p, ...opts }); written.push(p); };

// The hero: the first screen after the check, where the page puts the verdict (scrolled to it), the timeline below.
for (const [scheme, name] of [["light", "case-review.png"], ["dark", "case-review-dark.png"]]) {
  const { context, page } = await open(scheme);
  await page.goto(`${base}case/#sample`);
  await verified(page);
  await withChallenge(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await shot(page, name);
  await context.close();
}

if (process.env.ZECEIPT_SHOT_PAGES === "1") {
  for (const scheme of ["light", "dark"]) {
    const sfx = scheme === "dark" ? "-dark" : "";
    let { context, page } = await open(scheme);
    await page.goto(`${base}case/#sample`);
    await verified(page);
    await withChallenge(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `case-full${sfx}.png`, { fullPage: true });
    if (scheme === "light") {
      await page.emulateMedia({ media: "print" });
      const pdf = path.join(outDir, "case-report.pdf");
      await page.pdf({ path: pdf, format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
      written.push(pdf);
      await page.emulateMedia({ media: "screen" });
      // A failed case: the sample with its control nonce changed.
      const d = JSON.parse(read(path.join(repo, "fixtures/dossier/testnet-dossier.json")));
      d.claims[11].nonce = "zeceipt-challenge-00000000000000000000000000000000";
      await page.click("#inputs > summary");
      await page.setInputFiles("#file", { name: "dossier.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(d, null, 2)) });
      await page.waitForFunction(() => document.getElementById("headline").textContent === "1 claim failed");
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "case-failed.png", { fullPage: true });
    }
    await context.close();
    ({ context, page } = await open(scheme));
    await page.goto(base);
    await shot(page, `landing${sfx}.png`, { fullPage: true });
    await page.goto(`${base}build/`);
    await page.waitForFunction(() => /^Ready/.test(document.getElementById("status").textContent));
    await shot(page, `build${sfx}.png`, { fullPage: true });
    if (!live) {
      await page.fill("#ufvk", read(path.join(FIXTURES, "issuer-ufvk.txt")).trim());
      await page.fill("#txids", Object.keys(HEIGHTS).slice(0, 4).join("\n"));
      await page.fill("#nonce", "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8");
      await page.fill("#control-txid", "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43");
      await page.click("#build");
      await page.waitForSelector("#built:not([hidden])");
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `build-built${sfx}.png`, { fullPage: true });
    }
    await context.close();
  }
  const { context, page } = await open("light", 390, 844);
  await page.goto(`${base}case/#sample`);
  await verified(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "case-phone.png", { fullPage: true });
  await context.close();
}

await browser.close();
server.close();
console.log(written.join("\n"));
