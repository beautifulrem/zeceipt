// The design gallery: every console page in a realistic state, in light and dark, at desktop and phone widths.
// Run after `next build` from apps/console: `node test/shots/gallery.ts [out-dir]` (default: a new temp directory).
// Not a test: it renders what a person checks by eye. It uses the fake wallet and a local ZEC/USD ticker, so no chain
// or network is needed; the batch it pays is paid to the fake wallet, and its txid is the fake's.
// ZECEIPT_GALLERY_README=1 also writes docs/assets/console-batch{,-dark}.png for the README.
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP, baseEnv, raw, start, waitHealthy, within } from "../helpers/app-server.ts";
import { FakeZkool } from "../helpers/fake-zkool.ts";
import { ZKOOL_PUBLIC_PEM, zkoolPublicKeyFile, zkoolTokenFile } from "../helpers/zkool-token.ts";
import { englishChrome } from "../helpers/english-chrome.ts";
import { execFileSync } from "node:child_process";
import { autoIssue, batchDigest, batchNonce, getBatch, Keyring, openDb, recordReceipts, SqliteIdempotencyStore, toExecutionBatch, type AutoIssueResult } from "../../lib/index.ts";

const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), "zeceipt-gallery-"));
mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "gallery-db-"));
const ticker = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1601.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } })));
await new Promise<void>((r) => ticker.listen(0, "127.0.0.1", r));
const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
const env = {
  ...baseEnv(), ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9",
  ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(),
  ZECEIPT_DB_PATH: join(dir, "c.db"), ZECEIPT_ORG_ID: "gallery", ZECEIPT_NETWORK: "regtest",
  ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1",
  ZECEIPT_BIN: resolve(APP, "../../target/debug/zeceipt"), ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
  ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key", ZECEIPT_ISSUER_KEY_ID: "2026-09",
  ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  ZECEIPT_RATE_URL: `http://127.0.0.1:${(ticker.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`,
  ZECEIPT_AUTO_RECEIPTS_SECONDS: "0",
};
const s = await start(env as Record<string, string>);
const { browser, close } = await englishChrome();
try {
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const h = { host: self, origin: `http://${self}`, "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const post = async (path: string, body?: unknown, ok = [200, 201, 202]) => {
    const r = await raw(s.port, "POST", path, h, body === undefined ? undefined : JSON.stringify(body));
    if (!ok.includes(r.status)) throw new Error(`${path}: ${r.status} ${r.body}`);
    return JSON.parse(r.body || "{}") as Record<string, unknown>;
  };
  const A = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
  const B = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
  const ana = await post("/api/recipients", { displayName: "Ana Souza", address: A, kycStatus: "verified", taxFlag: "non_us" });
  const bo = await post("/api/recipients", { displayName: "Bo Chen", address: B, kycStatus: "unknown" });
  const ops = await post("/api/recipients", { displayName: "Ops wallet", address: A });
  const p1 = await post("/api/payables", { recipientId: ana.id, kind: "bounty", usdCents: 45_000, reference: "BOUNTY-101", sourceUrl: "https://github.com/org/repo/issues/101" });
  const p2 = await post("/api/payables", { recipientId: bo.id, kind: "milestone", usdCents: 1_500_000, reference: "GRANT-7 milestone 2", sourceUrl: "https://forum.zcashcommunity.com/t/grant-7" });
  await post("/api/payables", { recipientId: ops.id, kind: "salary", usdCents: 250_000, reference: "SALARY-2026-09" });
  await post("/api/payables", { recipientId: bo.id, kind: "bounty", usdCents: 12_000, reference: "BOUNTY-102" });
  // A paid batch: from payables at the ticker's rate, approved, paid to the fake wallet, then mined.
  const paid = await post("/api/batches/from-payables", { title: "September bounties", payableIds: [p1.id, p2.id] });
  const view = JSON.parse((await raw(s.port, "GET", `/api/batches/${paid.id}`, { host: self })).body) as { totalZat: string };
  const status = JSON.parse((await raw(s.port, "GET", `/api/batches/${paid.id}/status`, { host: self })).body) as { lock?: { seq: number } };
  await post(`/api/batches/${paid.id}/approve`, { confirmTotalZat: view.totalZat, lockSeq: status.lock?.seq ?? 1 });
  await post(`/api/batches/${paid.id}/submit`, { confirmTotalZat: view.totalZat });
  fake.mine(12);
  // A draft typed by hand, locked but not approved.
  const draft = await post("/api/batches", { title: "Contributor stipends", items: [{ payableId: "manual-1", address: B, zat: "31250000", memo: "STIPEND-OCT-1" }, { payableId: "manual-2", address: A, zat: "6250000", memo: "STIPEND-OCT-2" }] });
  await post(`/api/batches/${draft.id}/rate-lock`);
  // A batch with its receipts issued, as app.e2e's linkability test makes one: the committed regtest transaction's
  // three outputs, recorded as this batch's broadcast, receipted by the real CLI, and reported mined by the fake wallet.
  const ROOT = resolve(APP, "../..");
  const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
  const LINES = [
    { payableId: "p-2", label: "Ana Souza", address: A, zat: "101000000", memo: "INV-R-002" },
    { payableId: "p-3", label: "Bo Chen", address: B, zat: "102000000", memo: "INV-R-003" },
    { payableId: "p-4", label: "Chidi Okafor", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: "103000000", memo: "INV-R-004" },
  ];
  const issued = await post("/api/batches", { title: "October contributors", items: LINES });
  await post(`/api/batches/${String(issued.id)}/rate-lock`);
  const side = openDb({ path: env.ZECEIPT_DB_PATH });
  try {
    const rec = (await getBatch(side, env.ZECEIPT_ORG_ID, String(issued.id)))!;
    const store = new SqliteIdempotencyStore(side, { orgId: env.ZECEIPT_ORG_ID });
    const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: new Date().toISOString(), attempts: 1 };
    await store.createIntent({ ...base, state: "submitting" });
    await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
    const keyFile = join(dir, "issuer.key");
    execFileSync(env.ZECEIPT_BIN, ["keygen", "--out", keyFile]);
    const out = await autoIssue({ batch: toExecutionBatch(rec), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, cli: { bin: env.ZECEIPT_BIN, rawTxFile: join(ROOT, `fixtures/regtest-${TXID}.hex`), ufvkFile: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), keyFile, host: "https://receipts.example", keyId: "2026-09" } });
    await recordReceipts(side, new Keyring([{ kid: "k1", key: Buffer.alloc(32, 7) }]), { orgId: env.ZECEIPT_ORG_ID, batchId: rec.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });
  } finally {
    side.$client.close();
  }
  fake.mined.push({ txid: TXID, height: fake.height - 4, expiry: fake.height + 40, recipients: LINES.map((l) => ({ address: l.address, amount: l.zat, memo: l.memo })) });

  const pages: [string, string][] = [
    ["batches", "/"], ["batch-paid", `/batches/${paid.id}`], ["batch-draft", `/batches/${draft.id}`], ["batch-receipts", `/batches/${String(issued.id)}`],
    ["batch-new", "/batches/new"], ["from-payables", "/batches/from-payables"], ["void", `/batches/${draft.id}/void`],
    ["recipients", "/recipients"], ["payables", "/payables"], ["not-found", "/batches/0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f"],
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const [width, tag] of [[1280, "desktop"], [390, "phone"]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: tag === "phone" ? 2 : 1, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      for (const [name, path] of pages) {
        await page.goto(`http://${self}${path}`);
        // No page may be wider than the viewport (review F round 2: a nowrap cell once widened the whole layout).
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 0) throw new Error(`${name} (${scheme}, ${tag}) overflows the viewport by ${over}px`);
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
      await page.goto(`http://${self}/batches/${String(issued.id)}`);
      // The first screen only (review F round 2: a full page is too tall for a README); a receipted batch shows its
      // receipts before its lines, so they are in it.
      await page.screenshot({ path: join(assets, scheme === "light" ? "console-batch.png" : "console-batch-dark.png") });
      await context.close();
    }
  }
  console.log(`gallery: ${pages.length * 4} shots in ${OUT} (paid batch ${String(paid.id)}, fake pays ${fake.payCalls})`);
} finally {
  await close();
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  await fake.stop?.();
  ticker.close();
  rmSync(dir, { recursive: true, force: true });
}
