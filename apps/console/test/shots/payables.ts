// Screenshot of the payables page (slice H4, PRD AC3), re-runnable. Run after `next build` from apps/console:
// `node test/shots/payables.ts [out.png]`. Not a test: the assertions are in test/app.e2e.test.ts; this renders what a
// person checks by eye: exact dollars, the kind filter, the source host as link text, and an amount error in place.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";
const OUT = process.argv[2] ?? join(import.meta.dirname, "../../../../docs/product/screenshots/h4-payables.png");
const dir = mkdtempSync(join(tmpdir(), "h4-shot-"));
const env = { ...baseEnv(), ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "c.db"), ZECEIPT_ORG_ID: "shot", ZECEIPT_NETWORK: "regtest", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 4).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/x", ZECEIPT_UFVK_FILE: "/etc/x", ZECEIPT_ISSUER_KEY_FILE: "/etc/y", ZECEIPT_ISSUER_KEY_ID: "k" };
const s = await start(env as Record<string, string>);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: "chrome" });
try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const h = { host: self, origin: `http://${self}`, "content-type": "application/json" };
  const post = async (path: string, body: unknown) => {
    const r = await raw(s.port, "POST", path, h, JSON.stringify(body));
    if (r.status !== 201) throw new Error(`${path}: ${r.status} ${r.body}`);
    return JSON.parse(r.body) as { id: string };
  };
  const ops = await post("/api/recipients", { displayName: "Ops wallet", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w" });
  const carol = await post("/api/recipients", { displayName: "Carol", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj" });
  await post("/api/payables", { recipientId: carol.id, kind: "milestone", usdCents: 1_500_000, reference: "GRANT-7 milestone 2", sourceUrl: "https://forum.zcashcommunity.com/t/grant-7" });
  await post("/api/payables", { recipientId: ops.id, kind: "bounty", usdCents: 123_456, reference: "BOUNTY-17", sourceUrl: "https://github.com/org/repo/issues/17" });
  await post("/api/payables", { recipientId: carol.id, kind: "salary", usdCents: 250_000, reference: "SALARY-2026-09" });
  const page = await browser.newPage();
  await page.goto(`http://${self}/payables`);
  // The JS path: an amount with three decimals, shown under the amount with the values kept.
  await page.selectOption("select[name=recipientId]", { index: 2 });
  await page.fill('input[name="amount"]', "12.345");
  await page.fill('input[name="reference"]', "INV-2026-09-01");
  await page.click('button:has-text("Add payable")');
  await page.getByText("at most 2 decimal places").waitFor();
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("shot ok:", (await page.textContent("main"))?.replace(/\s+/g, " ").slice(0, 600));
} finally {
  await browser.close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  rmSync(dir, { recursive: true, force: true });
}
