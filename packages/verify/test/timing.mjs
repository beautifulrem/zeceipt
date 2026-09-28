// NFR-4, measured (slice P3): verifyReceipt's time in Chrome and in Node on the four committed fixture pairs, up to the
// 21,790-byte regtest batch (above the NFR's 20 KB bound). As PROOF §2b measured it: `performance.now()` around
// `verifyReceipt` from `src/index.js`, signed and challenge-bound receipts, 20 runs after one warm-up call.
// Run: `npm run test:timing` (needs Google Chrome, driven by playwright-core). Asserts every run is valid and under 1 s.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const RUNS = 20;
const FIXTURES = [
  { name: "synthetic", tx: "fixtures/synthetic-ironwood.hex", receipt: "fixtures/synthetic-receipt.json", challenge: "auditor-nonce-7" },
  { name: "devtool payment", tx: "fixtures/regtest-48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d.hex", receipt: "fixtures/regtest-receipt.json", challenge: "auditor-nonce-9" },
  { name: "Zkool batch", tx: "fixtures/regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex", receipt: "fixtures/regtest-zkool-batch-receipt.json", challenge: "auditor-nonce-9" },
  { name: "console batch (20 KB+)", tx: "fixtures/regtest-58794a9b32a9c051a7e9e44f319c114aabd6bfe2c334a85f0ca7321810c8a011.hex", receipt: "fixtures/regtest-20kb-receipt.json", challenge: "auditor-nonce-7" },
];
for (const f of FIXTURES) f.bytes = fs.readFileSync(path.join(repo, f.tx), "utf8").trim().length / 2;

const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".hex": "text/plain" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/timing.html") {
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>timing</title>");
    return;
  }
  const file = path.join(repo, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ""));
  if (!file.startsWith(repo) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const stats = (ms) => {
  const s = [...ms].sort((a, b) => a - b);
  return { mean: ms.reduce((a, b) => a + b, 0) / ms.length, median: (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2, max: s.at(-1) };
};
const fmt = (x) => x.toFixed(2);
let failures = 0;
const report = (where, f, r) => {
  const ok = r.valid.every(Boolean) && r.times.every((t) => t < 1000);
  if (!ok) failures++;
  const s = stats(r.times);
  console.log(`${ok ? "ok  " : "FAIL"} ${where.padEnd(7)} ${f.name.padEnd(24)} ${String(f.bytes).padStart(6)} bytes  mean ${fmt(s.mean)} ms  median ${fmt(s.median)} ms  max ${fmt(s.max)} ms  (${RUNS} runs, all valid: ${r.valid.every(Boolean)})`);
};

try {
  // Chrome: the package's own entry point, loaded as a browser loads it.
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(`${base}/timing.html`);
  const version = await page.evaluate(async () => { const m = await import("/packages/verify/src/index.js"); return m.initVerifier(); });
  console.log(`Chrome ${browser.version()}, ${version}`);
  for (const f of FIXTURES) {
    const r = await page.evaluate(async ({ f, runs }) => {
      const { verifyReceipt } = await import("/packages/verify/src/index.js");
      const [tx, receipt] = await Promise.all([fetch(`/${f.tx}`).then((x) => x.text()), fetch(`/${f.receipt}`).then((x) => x.text())]);
      const hex = tx.trim();
      verifyReceipt(receipt, hex, { challenge: f.challenge, requireSignature: true }); // warm-up
      const times = [], valid = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const out = verifyReceipt(receipt, hex, { challenge: f.challenge, requireSignature: true });
        times.push(performance.now() - t0);
        valid.push(out.valid === true);
      }
      return { times, valid };
    }, { f, runs: RUNS });
    report("Chrome", f, r);
  }
  await browser.close();

  // Node: the same entry point, with the WASM bytes.
  const m = await import("../src/index.js");
  await m.initVerifier(fs.readFileSync(path.join(here, "../pkg/zeceipt_wasm_bg.wasm")));
  console.log(`Node ${process.version}`);
  for (const f of FIXTURES) {
    const hex = fs.readFileSync(path.join(repo, f.tx), "utf8").trim();
    const receipt = fs.readFileSync(path.join(repo, f.receipt), "utf8");
    m.verifyReceipt(receipt, hex, { challenge: f.challenge, requireSignature: true });
    const times = [], valid = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const out = m.verifyReceipt(receipt, hex, { challenge: f.challenge, requireSignature: true });
      times.push(performance.now() - t0);
      valid.push(out.valid === true);
    }
    report("Node", f, { times, valid });
  }
} finally {
  server.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
