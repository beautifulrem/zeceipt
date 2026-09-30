// The design gallery: every console page in a realistic state, in light and dark, at desktop and phone widths.
// Run after `next build` from apps/console: `node test/shots/gallery.ts [out-dir]` (default: a new temp directory).
// It renders what a person checks by eye, and fails on a page wider than its viewport, a table scrolling inside its
// card, or an axe WCAG A/AA violation. It uses the fake wallet and a local ZEC/USD ticker, so no chain
// or network is needed; the batch it pays is paid to the fake wallet, and its txid is the fake's.
// ZECEIPT_GALLERY_README=1 also writes docs/assets/console-batch{,-dark}.png for the README.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP } from "../helpers/app-server.ts";
import { startDemoConsole } from "../helpers/demo-console.ts";
import { englishChrome } from "../helpers/english-chrome.ts";
import { AxeBuilder } from "@axe-core/playwright";

const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), "zeceipt-gallery-"));
mkdirSync(OUT, { recursive: true });
const demo = await startDemoConsole();
const { browser, close } = await englishChrome();
try {
  const { self, fake } = demo;
  const { paid, draft, issued } = demo.ids;

  // Tables that may scroll sideways on a 360px phone: their columns are all needed to act on a row.
  const PHONE_SCROLL: Record<string, string[]> = {};
  const pages: [string, string][] = [
    ["batches", "/"], ["batch-paid", `/batches/${paid}`], ["batch-draft", `/batches/${draft}`], ["batch-receipts", `/batches/${issued}`],
    ["batch-new", "/batches/new"], ["from-payables", "/batches/from-payables"], ["void", `/batches/${draft}/void`],
    ["recipients", "/recipients"], ["payables", "/payables"], ["not-found", "/batches/0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f"],
  ];
  for (const scheme of ["light", "dark"] as const) {
    // 360 px phones (common Android widths): narrower than an iPhone, which also leaves room for other fonts' metrics
    // (CI's Linux fonts are wider than macOS's).
    for (const [width, tag] of [[1280, "desktop"], [360, "phone"]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: tag === "phone" ? 2 : 1, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      for (const [name, path] of pages) {
        await page.goto(`http://${self}${path}`);
        // Measure in the page's own fonts: until Geist has loaded, the fallback's wider metrics were measured (CI on
        // Linux failed three tables that fit, one by one).
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // No page may be wider than the viewport (review F round 2: a nowrap cell once widened the whole layout).
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 0) throw new Error(`${name} (${scheme}, ${tag}) overflows the viewport by ${over}px`);
        // Nor may a table scroll inside its card on a desktop (review F round 3: a hidden Status column); on a phone,
        // only the tables listed in PHONE_SCROLL may, each a deliberate choice, and their cards show it (edge shadows).
        // A table "fits" only with room to spare: its narrowest layout (min-content) must leave room in its card, so a
        // different font rasteriser (CI's Linux) cannot tip it into scrolling (a table that fitted to the pixel did).
        // Locally 16 px, so a pass here predicts a pass elsewhere (Linux draws Geist about 5% wider than macOS); CI
        // measures its own rendering, where 2 px shows the table truly fits.
        const SLACK = process.env.CI ? 2 : 16;
        const scrolling = await page.evaluate((slack) => [...document.querySelectorAll(".table-card")].filter((c) => {
          const table = c.querySelector("table");
          if (!table) return false;
          const cs = getComputedStyle(c);
          const room = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const before = table.style.width;
          table.style.width = "min-content";
          const need = table.getBoundingClientRect().width;
          table.style.width = before;
          return need + slack > room;
        }).map((c) => (c as HTMLElement).dataset.label ?? ""), SLACK);
        const allowed = tag === "phone" ? PHONE_SCROLL[name] ?? [] : [];
        if (process.env.GALLERY_WIDTHS) {
          // Diagnostics: each table's narrowest width against its card's room, and the fonts the page actually uses.
          console.log(`${name} ${tag}`, await page.evaluate(() => [...document.querySelectorAll(".table-card")].map((c) => {
            const t = c.querySelector("table")!;
            const cs = getComputedStyle(c);
            const room = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const before = t.style.width;
            t.style.width = "min-content";
            const need = Math.round(t.getBoundingClientRect().width);
            t.style.width = before;
            return `${(c as HTMLElement).dataset.label}: needs ${need} of ${Math.round(room)}`;
          }).join("; ")), await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).join(",")));
        }
        const unexpected = scrolling.filter((l) => !allowed.includes(String(l)));
        if (unexpected.length) {
          const widths = await page.evaluate((l) => [...document.querySelectorAll(`.table-card[data-label="${l}"] th`)].map((th) => `${th.textContent}:${Math.round(th.getBoundingClientRect().width)}`).join(" "), unexpected[0]);
          const fonts = await page.evaluate(() => [...document.fonts].map((f) => `${f.family}:${f.status}`).join(","));
          const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
          throw new Error(`${name} (${scheme}, ${tag}): table cards scroll sideways: ${unexpected.join(", ")} (columns ${widths}; fonts ${fonts}; body ${body})`);
        }
        // Accessibility (review F round 6): axe's WCAG 2.0–2.2 A and AA rules, every page, both schemes, both widths.
        // Bounded: a paused animation's `finished` never settles (it once hung the suite).
        await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1000))]));
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        if (axe.violations.length) throw new Error(`${name} (${scheme}, ${tag}): axe: ${axe.violations.map((v) => `${v.id} [${v.nodes.map((n) => n.target.join(" ")).join(", ")}]`).join("; ")}`);
        await page.screenshot({ path: join(OUT, `${name}-${scheme}-${tag}.png`), fullPage: true });
      }
      await context.close();
    }
  }
  // ZECEIPT_GALLERY_README=1: the README's console images, the receipted batch at 2x, light and dark.
  if (process.env.ZECEIPT_GALLERY_README === "1") {
    const assets = resolve(APP, "../../docs/assets");
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1120 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`http://${self}/batches/${issued}`);
      // The first screen only (review F round 2: a full page is too tall for a README); a receipted batch shows its
      // receipts before its lines, so they are in it.
      await page.screenshot({ path: join(assets, scheme === "light" ? "console-batch.png" : "console-batch-dark.png") });
      await context.close();
    }
  }
  console.log(`gallery: ${pages.length * 4} shots in ${OUT} (paid batch ${paid}, fake pays ${fake.payCalls})`);
} finally {
  await close();
  await demo.stop();
}
