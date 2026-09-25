// Chrome with an English UI for footage and screenshots (slice L2, review round 1). On macOS, Chrome labels native
// controls (the file input's "Choose File") in its own UI language, which follows the system's AppleLanguages: the
// page's `locale`, `--lang` and LANG/LANGUAGE do not change it (all measured). `-AppleLanguages (en-US)` does, but
// playwright refuses it as a launch argument ("(en-US)" reads as a page to open), so Chrome is started here with it and
// a throwaway profile, and playwright attaches over CDP. recordVideo works over CDP (measured).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { freePort } from "./app-server.ts";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function englishChrome(): Promise<{ browser: Browser; close: () => Promise<void> }> {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "zeceipt-chrome-"));
  const child = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "-AppleLanguages", "(en-US)"], { stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error("Chrome did not open its DevTools port");
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return {
    browser,
    close: async () => {
      await browser.close().catch(() => {});
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
