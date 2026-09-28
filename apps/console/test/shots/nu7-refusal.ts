// Footage for weekly update 2 (slice WU2a; docs/outreach/weekly-update-2.md): the week's notable challenge, NU7's new
// consensus branch (ZIP 259, 0x77190AD9, R121) refused by name instead of reported as malformed bytes (slice U1a).
// No NU7 transaction exists yet, so the terminal shows the committed 20 KB batch transaction as it is, then the same bytes
// with the header's branch id (bytes 8 to 11) set to NU7's, and says so on screen; `crates/zeceipt-core/tests/branch.rs`
// makes the same input. No chain, key or network is needed. Each command runs as shown, in a scratch directory.
// Run from apps/console, after `cargo build --release`: `node test/shots/nu7-refusal.ts [out-dir]`.
// Outputs (outside the repository): 10-nu7-refusal.webm and shots.json (each step's offset, for editing and narration).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP } from "../helpers/app-server.ts";
import { englishChrome } from "../helpers/english-chrome.ts";

const ROOT = resolve(APP, "../..");
const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/release/zeceipt");
const TX = join(ROOT, "fixtures/regtest-58794a9b32a9c051a7e9e44f319c114aabd6bfe2c334a85f0ca7321810c8a011.hex");
const NU7 = 0x7719_0ad9;
const SIZE = { width: 1280, height: 800 };
const KEY = 4000; // ms on each beat the update narrates

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const OUT = resolve(process.argv[2] ?? join(ROOT, "../raw/demo", stamp));
mkdirSync(OUT, { recursive: true });

// The scratch directory: the fixture as it is, and the same bytes with NU7's branch id in the header.
const dir = mkdtempSync(join(tmpdir(), "zeceipt-nu7-"));
const hex = readFileSync(TX, "utf8").trim();
const bytes = Buffer.from(hex, "hex");
assert.equal(bytes.readUInt32LE(0), 0x8000_0006, "a v6 (overwintered) header");
assert.equal(bytes.readUInt32LE(8), 0x37a5_165b, "NU6.3's branch id");
const swapped = Buffer.from(bytes);
swapped.writeUInt32LE(NU7, 8);
writeFileSync(join(dir, "tx.hex"), hex);
writeFileSync(join(dir, "nu7-branch.hex"), swapped.toString("hex"));

const commands = [
  "head -c 24 tx.hex; echo",
  "zeceipt inspect --raw-tx-file tx.hex | jq -c '{version, outputs: (.outputs | length)}'",
  "head -c 24 nu7-branch.hex; echo",
  'zeceipt inspect --raw-tx-file nu7-branch.hex 2>&1; echo "exit code $?"',
];
const outputs = commands.map((c) => {
  const r = spawnSync("sh", ["-c", c], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${resolve(BIN, "..")}:${process.env.PATH}` } });
  assert.equal(r.status, 0, `${c}: ${r.stderr}`);
  return r.stdout;
});
assert.equal(outputs[0].trim(), "0600008098b684d85b16a537", "v6, its version group id, NU6.3's branch");
assert.deepEqual(JSON.parse(outputs[1]), { version: "V6", outputs: 6 });
assert.equal(outputs[2].trim(), "0600008098b684d8d90a1977", "the same header with NU7's branch id");
assert.match(outputs[3], /consensus branch 0x77190ad9 \(NU7, ZIP 259\), which this build of zeceipt does not support yet/);
assert.doesNotMatch(outputs[3], /malformed/);
assert.match(outputs[3], /exit code 3\n$/);

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const line = (i: number) => `<div id="c${i}" style="white-space:pre-wrap"><span style="color:#38bdf8">$</span> ${esc(commands[i])}</div><pre style="margin:0 0 10px;white-space:pre-wrap">${esc(outputs[i])}</pre>`;
const note = (text: string) => `<div style="color:#94a3b8;margin:14px 0 4px;white-space:pre-wrap"># ${esc(text)}</div>`;
const terminal = (body: string) => `<!doctype html><html style="background:#0b1020"><meta charset="utf-8"><title>terminal</title>
  <body style="margin:0;min-height:100vh;background:#0b1020;color:#e2e8f0;font:16px/1.5 ui-monospace,Menlo,monospace;padding:28px 36px;box-sizing:border-box">
  <div style="color:#94a3b8">~/nu7 (no chain needed)</div>${body}</body></html>`;
const before = note("tx.hex: a real v6 transaction from our regtest batch (five payments and the change), made under NU6.3") + line(0) + line(1);
const after = note("nu7-branch.hex: the same bytes, with header bytes 8 to 11 (the consensus branch id) set to NU7's 0x77190ad9.\n  No NU7 transaction exists yet: NU7 keeps the v5 and v6 formats, so this is what one's header will look like (ZIP 259)") + line(2) + line(3);

const chrome = await englishChrome();
const shots: { segment: string; file: string; steps: { atMs: number; step: string }[] }[] = [];
try {
  const vdir = join(OUT, ".nu7-refusal");
  const context = await chrome.browser.newContext({ viewport: SIZE, locale: "en-US", recordVideo: { dir: vdir, size: SIZE } });
  const page = await context.newPage();
  const t0 = Date.now();
  const steps: { atMs: number; step: string }[] = [];
  const step = async (label: string) => {
    steps.push({ atMs: Date.now() - t0, step: label });
    await page.waitForTimeout(KEY);
  };
  try {
    // Navigate once before setContent: a fresh page's first document records a grey band (CLAUDE.md, footage).
    await page.goto("data:text/html,");
    await page.setContent(terminal(before));
    await step("the batch transaction as it is: v6, NU6.3's branch 0x37a5165b in its header; inspect lists its six outputs");
    await page.setContent(terminal(before + after));
    await step("the same bytes with NU7's branch id: refused by name (NU7, ZIP 259, not supported yet), not reported as malformed; exit code 3");
  } finally {
    await context.close();
  }
  const [video] = readdirSync(vdir).filter((f) => f.endsWith(".webm"));
  renameSync(join(vdir, video), join(OUT, "10-nu7-refusal.webm"));
  rmSync(vdir, { recursive: true, force: true });
  shots.push({ segment: "nu7-refusal", file: "10-nu7-refusal.webm", steps });

  const index = {
    version: 1,
    stamp,
    note: "No chain: the committed batch transaction (fixtures/regtest-58794a9b….hex), and a copy with the header's branch id set to NU7's (0x77190ad9). No NU7 transaction exists yet.",
    binary: spawnSync(BIN, ["--version"], { encoding: "utf8" }).stdout.trim(),
    segments: shots,
  };
  writeFileSync(join(OUT, "shots.json"), `${JSON.stringify(index, null, 2)}\n`);
  for (const f of readdirSync(OUT)) console.log(`${f}\t${statSync(join(OUT, f)).size} bytes`);
  console.log(`footage in ${OUT}`);
} finally {
  await chrome.close();
  rmSync(dir, { recursive: true, force: true });
}
