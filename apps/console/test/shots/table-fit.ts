// Screenshot of a five-line batch made from payables at 1280 px (slice M1b, PRD AC1), re-runnable. Run after
// `next build` from apps/console: `NODE_USE_ENV_PROXY=1 node test/shots/table-fit.ts [out.png]`. The rate is Kraken's
// live ZEC/USD bid (the console's default source; review L2 round 1: never a made-up rate shown as Kraken's), so the
// amounts differ between runs; the point is the table's layout: one line per row, ids abridged, values unbroken.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";

const OUT = process.argv[2] ?? join(import.meta.dirname, "../../../../docs/product/screenshots/m1b-batch-five-lines.png");
const dir = mkdtempSync(join(tmpdir(), "m1b-shot-"));
const UAS = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
const PEOPLE = [["Ana Souza", "BOUNTY-101", 45000], ["Bo Chen", "BOUNTY-102", 12000], ["Chidi Okafor", "BOUNTY-103", 30000], ["Dana Kowalski", "BOUNTY-104", 18500], ["Eli Haddad", "BOUNTY-105", 22750]] as const;
const s = await start({
  ...baseEnv(), NODE_USE_ENV_PROXY: "1", NO_PROXY: "127.0.0.1,localhost",
  ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: join(dir, "c.db"), ZECEIPT_ORG_ID: "shot", ZECEIPT_NETWORK: "regtest",
  ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 4).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/x",
  ZECEIPT_UFVK_FILE: "/etc/x", ZECEIPT_ISSUER_KEY_FILE: "/etc/y", ZECEIPT_ISSUER_KEY_ID: "k",
});
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: "chrome" });
try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const json = { host: self, origin: `http://${self}`, "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const ids: string[] = [];
  for (const [i, [name, reference, usdCents]] of PEOPLE.entries()) {
    const r = JSON.parse((await raw(s.port, "POST", "/api/recipients", json, JSON.stringify({ displayName: name, address: UAS[i % UAS.length] }))).body) as { id: string };
    ids.push(JSON.parse((await raw(s.port, "POST", "/api/payables", json, JSON.stringify({ recipientId: r.id, kind: "bounty", usdCents, reference }))).body).id);
  }
  const b = await raw(s.port, "POST", "/api/batches/from-payables", json, JSON.stringify({ title: "September bounties", payableIds: ids }));
  if (b.status !== 201) throw new Error(`from-payables: ${b.status} ${b.body.slice(0, 200)}`);
  const { id } = JSON.parse(b.body) as { id: string };
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  await page.goto(`http://${self}/batches/${id}`);
  await page.locator("#items-heading").scrollIntoViewIfNeeded();
  const rows = await page.locator("section[aria-labelledby=items-heading] tbody tr").all();
  const heights = await Promise.all(rows.map(async (r) => Math.round((await r.boundingBox())!.height)));
  await page.locator("section[aria-labelledby=items-heading]").screenshot({ path: OUT });
  console.log(`rows ${rows.length}, heights ${heights.join(" ")} px`);
} finally {
  await browser.close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  rmSync(dir, { recursive: true, force: true });
}
