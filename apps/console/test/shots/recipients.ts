// Screenshot of the recipients page (slice H2, PRD AC3; kept in the repo at review H2's suggestion so the check can be
// re-run). Run after `next build` from apps/console: `node test/shots/recipients.ts [out.png]`. Not a test: the
// assertions it relies on are in test/app.e2e.test.ts; this only renders the state a person checks by eye:
// a duplicate with a different address string (the same Orchard receiver), the ZIP 316 prefix, and a field error.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";
const OUT = process.argv[2] ?? join(import.meta.dirname, "../../../../docs/product/screenshots/h2-recipients.png");
const dir = mkdtempSync(join(tmpdir(), "h2-shot-"));
const env = { ...baseEnv(), ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "c.db"), ZECEIPT_ORG_ID: "shot", ZECEIPT_NETWORK: "regtest", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 4).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/x", ZECEIPT_UFVK_FILE: "/etc/x", ZECEIPT_ISSUER_KEY_FILE: "/etc/y", ZECEIPT_ISSUER_KEY_ID: "k" };
const s = await start(env as Record<string, string>);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: "chrome" });
try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const h = { host: self, origin: `http://${self}`, "content-type": "application/json" };
  const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
  // A different string with the same Orchard receiver: the Orchard item re-encoded beside a Sapling one (H1 round 1).
  const { checkUnifiedAddress } = await import("../../lib/execution/address.ts");
  const { ua, item } = await import("../helpers/ua-encoder.ts");
  const dec = checkUnifiedAddress(UA, "regtest");
  if (!dec.ok) throw new Error("control UA");
  const orchard = dec.receivers.find((r) => r.typecode === 3)!;
  const UA2 = ua("uregtest", [item(2, 43), [3, 43, ...orchard.data]]);
  for (const b of [{ displayName: "Ops wallet", address: UA, kycStatus: "verified", taxFlag: "non_us" }, { displayName: "Grants wallet", address: UA2 }, { displayName: "Carol", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj" }]) await console.log("create", b.displayName, (await raw(s.port, "POST", "/api/recipients", h, JSON.stringify(b))).status);
  const page = await browser.newPage();
  await page.goto(`http://${self}/recipients`);
  // The JS path: add with a wrong-network address, see the error under the field.
  await page.fill('input[name="displayName"]', "Bob");
  await page.fill('input[name="address"]', "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel");
  await page.click('button:has-text("Add recipient")');
  await page.getByText("expected a regtest unified address").waitFor();
  await page.locator("details summary").first().click();
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("shot ok:", (await page.textContent("main"))?.replace(/\s+/g, " ").slice(0, 700));
} finally {
  await browser.close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  rmSync(dir, { recursive: true, force: true });
}
