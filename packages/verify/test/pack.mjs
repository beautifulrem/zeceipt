// The package as a user gets it (slice R1b1; REQ-WEB-8): pack the tarball, pin its files and publish settings, install
// it into an empty project offline (it has no dependencies), and run the README's own Node example through the
// package's entry point against the committed synthetic fixture.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, "..");
const repoRoot = path.join(pkgDir, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const readme = fs.readFileSync(path.join(pkgDir, "README.md"), "utf8");

let failures = 0;
const check = (name, cond, detail) => { if (!cond) { failures++; console.error("FAIL", name, detail ?? ""); } else console.log("ok  ", name); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeceipt-pack-"));
const npm = (args, cwd) => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  // npm's docs: scoped packages are published private unless told otherwise (R115).
  check("publishConfig.access is public", manifest.publishConfig?.access === "public", JSON.stringify(manifest.publishConfig));

  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", tmp], pkgDir));
  const files = packed.files.map((f) => f.path).sort();
  const expected = [
    "LICENSE", "NOTICE", "README.md", "package.json",
    "pkg/package.json", "pkg/zeceipt_wasm.d.ts", "pkg/zeceipt_wasm.js", "pkg/zeceipt_wasm_bg.wasm", "pkg/zeceipt_wasm_bg.wasm.d.ts",
    "src/index.d.ts", "src/index.js",
  ];
  check("the tarball holds exactly the package's files (no tests, demo, page or lockfile)", JSON.stringify(files) === JSON.stringify(expected), JSON.stringify(files));

  // Every repository link in the README goes through package.json's repository URL, on the branch that exists, to a
  // file that exists: one place to change if the repository's name or default branch changes at the push (2.4.3.4).
  const repo = manifest.repository.url.replace(/\.git$/, "");
  const links = [...readme.matchAll(/\]\((https:\/\/github\.com\/[^)]+)\)/g)].map((m) => m[1]);
  // The pushed repository's default branch: this repository's only branch is master. Not read from git, which has no
  // current branch in a CI checkout of a pull request.
  const branch = process.env.ZECEIPT_DEFAULT_BRANCH ?? "master";
  check("the README links the repository", links.length > 0);
  for (const link of links) {
    const prefix = `${repo}/blob/${branch}/`;
    check(`README link ${link} is ${prefix}<a committed file>`, link.startsWith(prefix) && fs.existsSync(path.join(repoRoot, link.slice(prefix.length))));
  }

  // The README's Node example, verbatim, run in an empty project that installed the tarball.
  const blocks = [...readme.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
  const nodeExample = blocks.find((b) => b.includes("node:fs/promises"));
  check("the README has a Node example", nodeExample !== undefined);
  const app = path.join(tmp, "app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "app", private: true, type: "module" }));
  npm(["install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts", path.join(tmp, packed.filename)], app);
  const fixtures = path.join(pkgDir, "demo/fixtures");
  const receiptJson = fs.readFileSync(path.join(fixtures, "synthetic-receipt-bearer.json"), "utf8");
  const rawTxHex = fs.readFileSync(path.join(fixtures, "synthetic-ironwood.hex"), "utf8").trim();
  // First a load that fails (no bytes, in Node), which must not stick: the README's example then loads and verifies.
  const script = `import * as first from "@zeceipt/verify";
const failedFirst = await first.initVerifier().then(() => false, () => true);
const receiptJson = ${JSON.stringify(receiptJson)};
const rawTxHex = ${JSON.stringify(rawTxHex)};
${nodeExample}
import { parseReceipt, checkSignature } from "@zeceipt/verify";
const tampered = JSON.parse(receiptJson);
tampered.ock = tampered.ock.slice(0, -1) + (tampered.ock.endsWith("A") ? "B" : "A");
console.log(JSON.stringify({
  failedFirst, valid: result.valid, value_zat: result.value_zat, memo: result.memo,
  tampered: verifyReceipt(JSON.stringify(tampered), rawTxHex).valid,
  parsed: parseReceipt(receiptJson).txid, signature: checkSignature(receiptJson),
}));
`;
  fs.writeFileSync(path.join(app, "check.mjs"), script);
  const out = JSON.parse(execFileSync(process.execPath, ["check.mjs"], { cwd: app, encoding: "utf8" }));
  check("through the installed package: a first load without the bytes fails in Node, and does not stick (slice R1b2)", out.failedFirst === true, JSON.stringify(out));
  check("through the installed package: the fixture verifies, 2.5 ZEC", out.valid === true && out.value_zat === 250000000, JSON.stringify(out));
  check("through the installed package: a tampered OCK does not verify", out.tampered === false);
  check("through the installed package: parseReceipt reads the txid", out.parsed === JSON.parse(receiptJson).txid, out.parsed);
  check("through the installed package: checkSignature answers", typeof out.signature?.signed === "boolean", JSON.stringify(out.signature));

  console.log(`repository.url: ${manifest.repository.url} (must match the pushed repository before publishing)`);
  console.log(`tarball: ${packed.filename}, ${packed.size} bytes packed, ${packed.unpackedSize} unpacked, ${files.length} files`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
