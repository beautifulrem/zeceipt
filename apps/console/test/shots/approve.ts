// Screenshots of approval before payment (slice I3, PRD AC4), re-runnable. Run after `next build` from apps/console:
// `node test/shots/approve.ts [dir]`. Two shots of one batch page, as a person checks it by eye: locked and waiting
// for approval (the button names the total and the rate; no Pay yet), then approved (Pay appears, the lifecycle
// marks Approved). Hot custody against the fake Zkool and a fake ticker: nothing is paid.
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";
import { FakeZkool } from "../helpers/fake-zkool.ts";

const OUT = process.argv[2] ?? join(import.meta.dirname, "../../../../docs/product/screenshots");
const dir = mkdtempSync(join(tmpdir(), "i3-shot-"));
const ticker = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: ["41.52", "1", "1"], b: ["41.47", "1", "1"], c: ["41.50", "0.1"] } } })));
await new Promise<void>((r) => ticker.listen(0, "127.0.0.1", r));
const fake = await new FakeZkool().start();
const env = {
  ...baseEnv(), ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_AUTO_RECEIPTS_SECONDS: "0",
  ZECEIPT_DB_PATH: join(dir, "c.db"), ZECEIPT_ORG_ID: "shot", ZECEIPT_NETWORK: "regtest", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 4).toString("base64")}`,
  ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/x", ZECEIPT_UFVK_FILE: "/etc/x", ZECEIPT_ISSUER_KEY_FILE: "/etc/y", ZECEIPT_ISSUER_KEY_ID: "k",
  ZECEIPT_RATE_URL: `http://127.0.0.1:${(ticker.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
};
const s = await start(env as Record<string, string>);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: "chrome" });
try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const same = { host: self, origin: `http://${self}`, "content-type": "application/json" };
  const r = await raw(s.port, "POST", "/api/batches", same, JSON.stringify({ title: "September contributors", items: [
    { payableId: "inv-1", label: "Ops wallet", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "77160000", memo: "BOUNTY-17" },
    { payableId: "inv-2", label: "Carol", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "937500000", memo: "GRANT-7 milestone 2" },
  ] }));
  const { id } = JSON.parse(r.body) as { id: string };
  if ((await raw(s.port, "POST", `/api/batches/${id}/rate-lock`, { host: self, origin: `http://${self}` })).status !== 201) throw new Error("lock failed");
  const page = await browser.newPage();
  await page.goto(`http://${self}/batches/${id}`);
  await page.getByRole("button", { name: /^Approve paying/ }).waitFor();
  await page.screenshot({ path: join(OUT, "i3-approve.png"), fullPage: true });
  await page.getByRole("button", { name: /^Approve paying/ }).click();
  await page.getByRole("button", { name: /^Pay / }).waitFor();
  await page.screenshot({ path: join(OUT, "i3-approved.png"), fullPage: true });
  console.log("shot ok:", (await page.textContent("main"))?.replace(/\s+/g, " ").slice(0, 400));
} finally {
  await browser.close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  await fake.stop();
  ticker.close();
  rmSync(dir, { recursive: true, force: true });
}
