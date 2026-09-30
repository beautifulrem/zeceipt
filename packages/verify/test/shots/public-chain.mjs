// Footage of the live receipt page on public chains (PM round 3, P07), nothing simulated: the page on GitHub Pages asks
// real nodes. Three clips, each opened as its reader would open the link, fetched, and held on the verdict:
//   1. a zeceipt receipt on testnet (fixtures/testnet/, INV-T-001, signed; PROOF §6);
//   2. the recipient's own zdp:1 delivery proof of the same payment (fixtures/testnet/INV-T-001.recipient.zdp);
//   3. zcash-delivery-proof's mainnet vector, a third party's payment (fixtures/zdp/mainnet.json; PROOF §7).
// Usage: node test/shots/public-chain.mjs [out-dir] (default ../../../raw/demo/public-<stamp>/, outside the repository);
// ZECEIPT_SITE overrides the site (default https://beautifulremi.dpdns.org/zeceipt). Writes 1-…webm to 3-…webm and
// shots.json (each step's offset).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..", "..", "..");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const out = process.argv[2] ?? path.join(repo, "..", "raw", "demo", `public-${stamp}`);
fs.mkdirSync(out, { recursive: true });
const site = (process.env.ZECEIPT_SITE ?? "https://beautifulremi.dpdns.org/zeceipt").replace(/\/$/, "");

const receipt = fs.readFileSync(path.join(repo, "fixtures/testnet/fcfde625685b43d7-ironwood-2.json"), "utf8");
const clips = [
  ["1-testnet-receipt", `${site}/r#${Buffer.from(receipt.trim()).toString("base64url")}`, "a signed zeceipt receipt on testnet: VALID, mined, the issuer's key"],
  ["2-testnet-recipient-proof", `${site}/r#${fs.readFileSync(path.join(repo, "fixtures/testnet/INV-T-001.recipient.zdp"), "utf8").trim()}`, "the recipient's own zdp:1 proof of the same payment: VALID, no issuer"],
  ["3-mainnet-zdp-vector", `${site}/r#${JSON.parse(fs.readFileSync(path.join(repo, "fixtures/zdp/mainnet.json"), "utf8")).proof}`, "a third party's mainnet payment (zcash-delivery-proof's vector): VALID, mined"],
];

const browser = await chromium.launch({ channel: "chrome", args: ["--lang=en-US"] });
const shots = [];
try {
  for (const [name, url, what] of clips) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US", colorScheme: "light", recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
    const page = await context.newPage();
    const t0 = Date.now();
    const steps = [];
    const step = (s) => steps.push({ atMs: Date.now() - t0, step: s });
    await page.goto(url);
    await page.waitForFunction(() => /verification runs in this page/.test(document.getElementById("status").textContent), null, { timeout: 30_000 });
    step("the link opened: what it claims, before anything is fetched");
    await page.waitForTimeout(1500);
    await page.click("#fetch");
    await page.waitForSelector("#outcome:not([hidden])", { timeout: 60_000 });
    await page.waitForFunction(() => !/asking it for its chain tip/.test(document.querySelector("#inclusion").textContent), null, { timeout: 30_000 });
    step(what);
    const verdict = `${await page.textContent("#headline")}: ${await page.textContent("#verdict-note")}`;
    if (!/^VALID/.test(verdict)) throw new Error(`${name}: ${verdict}`);
    await page.waitForTimeout(3000);
    await page.locator("#parts").scrollIntoViewIfNeeded();
    step("the three parts: the payment, its chain inclusion, the issuer");
    await page.waitForTimeout(3000);
    const video = page.video();
    await context.close();
    fs.renameSync(await video.path(), path.join(out, `${name}.webm`));
    shots.push({ clip: name, file: `${name}.webm`, verdict, steps });
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, "shots.json"), JSON.stringify({ site, recorded: new Date().toISOString(), clips: shots }, null, 2));
console.log(`footage in ${out}`);
for (const s of shots) console.log(`${s.file}: ${s.verdict}`);
