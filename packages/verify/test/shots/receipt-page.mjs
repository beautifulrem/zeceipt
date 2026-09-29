// The README's screenshot of the receipt page: the committed synthetic bearer receipt opened by its link, verified
// in Chrome. The node is simulated as in page.e2e.mjs (the synthetic transaction is not on any chain), so the height
// and depth shown are the test suite's, not a real block. Usage: node test/shots/receipt-page.mjs [out.png]
// Chrome on macOS labels the file input in the system's language; ZECEIPT_SHOT_CHROME=<path to Playwright's
// chrome-headless-shell> takes --lang=en-US, as the committed image did. ZECEIPT_SHOT_SCHEME=dark, ZECEIPT_SHOT_WIDTH=390
// and ZECEIPT_SHOT_FULL=1 render the other variants the design review looks at.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const out = process.argv[2] ?? path.join(root, "..", "..", "docs", "assets", "receipt-page.png");
const read = (p) => fs.readFileSync(p, "utf8").trim();
const BEARER = read(path.join(root, "demo/fixtures/synthetic-receipt-bearer.json"));
const HEX = read(path.join(root, "demo/fixtures/synthetic-ironwood.hex"));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const varint = (n) => { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const frame = (flag, b) => { const f = Buffer.alloc(5 + b.length); f[0] = flag; f.writeUInt32BE(b.length, 1); Buffer.from(b).copy(f, 5); return f; };
const trailer = frame(0x80, Buffer.from("grpc-status:0\r\n"));
const headers = { "content-type": "application/grpc-web+proto", "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

const browser = await chromium.launch(process.env.ZECEIPT_SHOT_CHROME ? { executablePath: process.env.ZECEIPT_SHOT_CHROME, args: ["--lang=en-US"] } : { channel: "chrome", args: ["--lang=en-US"] });
const context = await browser.newContext({ viewport: { width: Number(process.env.ZECEIPT_SHOT_WIDTH ?? 900), height: 900 }, deviceScaleFactor: 2, locale: "en-US", colorScheme: process.env.ZECEIPT_SHOT_SCHEME ?? "light", reducedMotion: "reduce" });
await context.route("https://**/*", (route) => {
  const url = route.request().url();
  if (!url.startsWith("https://zjs.zec.rocks/")) return route.abort();
  if (url.endsWith("/GetLatestBlock")) return route.fulfill({ status: 200, headers, body: Buffer.concat([frame(0, [0x08, ...varint(3491293n)]), trailer]) });
  const data = Buffer.from(HEX, "hex");
  return route.fulfill({ status: 200, headers, body: Buffer.concat([frame(0, [0x0a, ...varint(data.length), ...data, 0x10, ...varint(3491284n)]), trailer]) });
});
const page = await context.newPage();
await page.goto(`${base}/r/#${Buffer.from(BEARER).toString("base64url")}`);
await page.waitForFunction(() => /verification runs in this page/.test(document.getElementById("status").textContent));
await page.click("#fetch");
await page.waitForSelector("#outcome:not([hidden])");
await page.waitForFunction(() => !/asking it for its chain tip/.test(document.querySelector("#inclusion").textContent));
const box = await page.locator("#outcome").boundingBox(); // the page down to the verdict
await page.screenshot(process.env.ZECEIPT_SHOT_FULL ? { path: out, fullPage: true } : { path: out, fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(box.y + box.height + 24) } });
await browser.close();
server.close();
console.log(out);
