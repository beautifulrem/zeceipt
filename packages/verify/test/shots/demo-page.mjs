// The paste demo, light and dark, with the sample verified (review F round 7). Not a test: what a person checks by eye.
// The screenshot is taken from the top, so the sticky top bar sits where it belongs. Usage: node test/shots/demo-page.mjs
// [out-dir]; ZECEIPT_SHOT_CHROME as in receipt-page.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = process.argv[2] ?? fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "zeceipt-demo-"));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".hex": "text/plain" };
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(process.env.ZECEIPT_SHOT_CHROME ? { executablePath: process.env.ZECEIPT_SHOT_CHROME, args: ["--lang=en-US"] } : { channel: "chrome", args: ["--lang=en-US"] });
for (const colorScheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, colorScheme, reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:${server.address().port}/demo/`);
  await page.waitForFunction(() => /Ready/.test(document.getElementById("status").textContent));
  await page.click("#sample");
  await page.waitForFunction(() => document.getElementById("rawtx").value.length > 100);
  await page.click("#verify");
  await page.waitForSelector(".result");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, `demo-${colorScheme}.png`), fullPage: true });
  await page.close();
}
await browser.close();
server.close();
console.log(out);
