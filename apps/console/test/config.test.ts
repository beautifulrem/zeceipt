// Console configuration (slice C1): REQ-CON-17's custody test, every variable's rules, all problems at
// once, no secret in any output, and the one-owner rule (only lib/config/env.ts reads ZECEIPT_* vars).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError, configSummary, keyringFromConfig, loadConfig } from "../lib/index.ts";

const K1 = Buffer.alloc(32, 0xa1).toString("base64");
const K2 = Buffer.alloc(32, 0xb2).toString("base64");
const hot: Record<string, string> = {
  ZECEIPT_CUSTODY_MODE: "hot",
  ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql",
  ZECEIPT_ZKOOL_ACCOUNT: "9",
  ZECEIPT_DB_PATH: "/var/lib/zeceipt/console.db",
  ZECEIPT_ORG_ID: "demo-org",
  ZECEIPT_NETWORK: "regtest",
  ZECEIPT_WRAP_KEYS: `k1:${K1},k2:${K2}`,
  ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
  ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
  ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
  ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
  ZECEIPT_ISSUER_KEY_ID: "2026-09",
};
const external = (() => {
  const e = { ...hot, ZECEIPT_CUSTODY_MODE: "external" };
  delete (e as Record<string, string | undefined>).ZECEIPT_ZKOOL_URL;
  delete (e as Record<string, string | undefined>).ZECEIPT_ZKOOL_ACCOUNT;
  return e;
})();
const problems = (env: Record<string, string | undefined>) => {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    assert.ok(e instanceof ConfigError, String(e));
    return e.problems.map((p) => p.variable).sort();
  }
};

test("REQ-CON-17: external custody refuses any Zkool setting; hot custody requires the Zkool URL and account", () => {
  const c = loadConfig(external);
  assert.deepEqual(c.custody, { mode: "external" });
  assert.deepEqual(problems({ ...external, ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql" }), ["ZECEIPT_ZKOOL_URL"]);
  assert.deepEqual(problems({ ...external, ZECEIPT_ZKOOL_ACCOUNT: "9" }), ["ZECEIPT_ZKOOL_ACCOUNT"]);
  assert.deepEqual(problems({ ...external, ZECEIPT_ZKOOL_ALLOW_REMOTE: "false" }), ["ZECEIPT_ZKOOL_ALLOW_REMOTE"]);
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_URL: undefined }), ["ZECEIPT_ZKOOL_URL"]);
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_ACCOUNT: "" }), ["ZECEIPT_ZKOOL_ACCOUNT"]);
  assert.deepEqual(loadConfig(hot).custody, { mode: "hot", zkool: { url: "http://127.0.0.1:9000/graphql", account: 9, allowRemote: false } });
  assert.deepEqual(problems({ ...hot, ZECEIPT_CUSTODY_MODE: "custodial" }), ["ZECEIPT_CUSTODY_MODE"]);
  assert.deepEqual(problems({ ...hot, ZECEIPT_CUSTODY_MODE: undefined }), ["ZECEIPT_CUSTODY_MODE"]);
});

test("a valid configuration is typed, frozen, and defaults applied", () => {
  const c = loadConfig({ ...hot, ZECEIPT_ZKOOL_ALLOW_REMOTE: "true" });
  assert.equal(c.confirmations, 3);
  assert.equal(c.custody.mode === "hot" && c.custody.zkool.allowRemote, true);
  assert.deepEqual(c.wrapKeys.map((k) => k.kid), ["k1", "k2"]);
  assert.deepEqual(Buffer.from(c.wrapKeys[1].key.reveal()), Buffer.alloc(32, 0xb2));
  // reveal() hands out a copy: mutating it cannot change the stored key ("deep-frozen" includes the bytes).
  const copy = c.wrapKeys[1].key.reveal();
  copy[0] ^= 0xff;
  assert.deepEqual(Buffer.from(c.wrapKeys[1].key.reveal()), Buffer.alloc(32, 0xb2));
  assert.equal(loadConfig({ ...hot, ZECEIPT_ZKOOL_URL: "HTTP://127.0.0.1:9000" }).custody.mode === "hot" && (loadConfig({ ...hot, ZECEIPT_ZKOOL_URL: "HTTP://127.0.0.1:9000" }).custody as { zkool: { url: string } }).zkool.url, "http://127.0.0.1:9000/", "URLs are stored normalised");
  assert.equal(loadConfig({ ...hot, ZECEIPT_CONFIRMATIONS: "12" }).confirmations, 12);
  // Slice I2 (REQ-CON-11): automatic receipts every 60 s by default; 0 turns them off; at most a day (BTCPay's bound).
  assert.equal(c.autoReceiptsSeconds, 60);
  assert.deepEqual([loadConfig({ ...hot, ZECEIPT_AUTO_RECEIPTS_SECONDS: "0" }).autoReceiptsSeconds, loadConfig({ ...hot, ZECEIPT_AUTO_RECEIPTS_SECONDS: "86400" }).autoReceiptsSeconds], [0, 86400]);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.issuer) && Object.isFrozen(c.wrapKeys) && Object.isFrozen(c.custody));
  assert.throws(() => ((c as { orgId: string }).orgId = "x"), TypeError);
  // Only ZECEIPT_* variables matter; other process variables are ignored.
  assert.doesNotThrow(() => loadConfig({ ...hot, PATH: "/usr/bin", NODE_ENV: "production" }));
});

test("every rule, and all problems reported together", () => {
  const bad = {
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: "ftp://x",
    ZECEIPT_ZKOOL_ACCOUNT: "-1",
    ZECEIPT_ZKOOL_ALLOW_REMOTE: "yes",
    ZECEIPT_DB_PATH: ":memory:",
    ZECEIPT_ORG_ID: "Demo Org",
    ZECEIPT_NETWORK: "mainnet",
    ZECEIPT_CONFIRMATIONS: "0",
    ZECEIPT_WRAP_KEYS: "k1:short",
    ZECEIPT_LIGHTWALLETD_URL: "not a url",
    ZECEIPT_BIN: "zeceipt",
    ZECEIPT_UFVK_FILE: "relative/ufvk",
    ZECEIPT_ISSUER_KEY_FILE: "file:/etc/key",
    ZECEIPT_ISSUER_KEY_ID: "bad id!",
    ZECEIPT_CONFIRMATION: "6",
  };
  assert.deepEqual(problems(bad), [
    "ZECEIPT_BIN",
    "ZECEIPT_CONFIRMATION",
    "ZECEIPT_CONFIRMATIONS",
    "ZECEIPT_DB_PATH",
    "ZECEIPT_ISSUER_KEY_FILE",
    "ZECEIPT_ISSUER_KEY_ID",
    "ZECEIPT_LIGHTWALLETD_URL",
    "ZECEIPT_NETWORK",
    "ZECEIPT_ORG_ID",
    "ZECEIPT_UFVK_FILE",
    "ZECEIPT_WRAP_KEYS",
    "ZECEIPT_ZKOOL_ACCOUNT",
    "ZECEIPT_ZKOOL_ALLOW_REMOTE",
    "ZECEIPT_ZKOOL_URL",
  ]);
  for (const [k, v] of [["CONFIRMATIONS", "101"], ["CONFIRMATIONS", "3.5"], ["AUTO_RECEIPTS_SECONDS", "-1"], ["AUTO_RECEIPTS_SECONDS", "86401"], ["AUTO_RECEIPTS_SECONDS", "1.5"], ["ZKOOL_ACCOUNT", "1e3"], ["DB_PATH", "file:/x.db"], ["ORG_ID", "x".repeat(65)]] as const) {
    assert.deepEqual(problems({ ...hot, [`ZECEIPT_${k}`]: v }), [`ZECEIPT_${k}`], `${k}=${v}`);
  }
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_URL: "http://user:pw@127.0.0.1:9000/graphql" }), ["ZECEIPT_ZKOOL_URL"], "credentials in a URL");
  assert.deepEqual(problems({ ...hot, ZECEIPT_LIGHTWALLETD_URL: "https://user@lwd.example" }), ["ZECEIPT_LIGHTWALLETD_URL"], "user in a URL");
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_URL: "http://10.0.0.5:9000/graphql" }), ["ZECEIPT_ZKOOL_URL"], "remote Zkool without the opt-in");
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_URL: "http://10.0.0.5:9000/graphql", ZECEIPT_ZKOOL_ALLOW_REMOTE: "true" }), [], "remote Zkool with the opt-in");
  assert.deepEqual(problems({ ...hot, ZECEIPT_DB_PATH: "/var/lib/a\nb.db" }), ["ZECEIPT_DB_PATH"], "control character in a path");
  const missing = problems({});
  assert.ok(missing.includes("ZECEIPT_CUSTODY_MODE") && missing.includes("ZECEIPT_WRAP_KEYS") && missing.includes("ZECEIPT_DB_PATH"));
});

test("receipt host: https (http only on loopback), no credentials, query or fragment; a path prefix kept, the trailing slash dropped; default the CLI's", () => {
  const host = (v: string | undefined) => loadConfig({ ...hot, ZECEIPT_RECEIPT_HOST: v }).receiptHost;
  assert.equal(host(undefined), "https://zeceipt.xyz", "unset: the CLI's default");
  assert.equal(host(""), "https://zeceipt.xyz", "empty counts as unset");
  assert.equal(host("https://receipts.example.org"), "https://receipts.example.org");
  assert.equal(host("https://Receipts.Example.org/"), "https://receipts.example.org", "normalised; trailing / dropped");
  assert.equal(host("https://user.github.io/zeceipt/"), "https://user.github.io/zeceipt", "a path prefix (a project site) is kept");
  for (const local of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) assert.equal(host(local), local, local);
  for (const bad of ["http://receipts.example.org", "ftp://receipts.example.org", "https://u:p@receipts.example.org", "https://receipts.example.org/?x=1", "https://receipts.example.org/?", "https://receipts.example.org/#x", "https://receipts.example.org#", "receipts.example.org", "not a url"]) {
    assert.deepEqual(problems({ ...hot, ZECEIPT_RECEIPT_HOST: bad }), ["ZECEIPT_RECEIPT_HOST"], bad);
  }
  // The message is ours: it never echoes the value (C1).
  try {
    loadConfig({ ...hot, ZECEIPT_RECEIPT_HOST: "https://secret-user:secret-pass@x.example" });
    assert.fail("should refuse");
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.ok(!e.message.includes("secret-user") && !e.message.includes("secret-pass"), e.message);
  }
  assert.equal(configSummary(loadConfig({ ...hot, ZECEIPT_RECEIPT_HOST: "http://127.0.0.1:8787" })).receiptHost, "http://127.0.0.1:8787");
});

test("rate source: Kraken's Ticker by default; https, or http on loopback; a query allowed; no credentials or fragment (slice G1c1)", () => {
  const url = (v: string | undefined) => loadConfig({ ...hot, ZECEIPT_RATE_URL: v }).rateUrl;
  assert.equal(url(undefined), "https://api.kraken.com/0/public/Ticker?pair=ZECUSD");
  assert.equal(url("https://mirror.example.org/0/public/Ticker?pair=ZECUSD"), "https://mirror.example.org/0/public/Ticker?pair=ZECUSD");
  assert.equal(url("http://127.0.0.1:9911/ticker"), "http://127.0.0.1:9911/ticker");
  for (const bad of ["http://mirror.example.org/ticker", "https://u:p@mirror.example.org/", "https://mirror.example.org/#x", "https://mirror.example.org/#", "file:///etc/passwd", "ticker"]) {
    assert.deepEqual(problems({ ...hot, ZECEIPT_RATE_URL: bad }), ["ZECEIPT_RATE_URL"], bad);
  }
  try {
    loadConfig({ ...hot, ZECEIPT_RATE_URL: "https://secret-user:secret-pass@x.example" });
    assert.fail("should refuse");
  } catch (e) {
    assert.ok(e instanceof ConfigError && !e.message.includes("secret-pass"));
  }
  assert.equal(configSummary(loadConfig(hot)).rateUrl, "https://api.kraken.com/0/public/Ticker?pair=ZECUSD");
});

test("rate drift threshold: 300 basis points (3%, REQ-CON-21) by default; an integer from 1 to 2000 (slice G2a)", () => {
  assert.equal(loadConfig(hot).rateMaxDriftBps, 300);
  assert.equal(loadConfig({ ...hot, ZECEIPT_RATE_MAX_DRIFT_BPS: "100" }).rateMaxDriftBps, 100);
  for (const bad of ["0", "2001", "3%", "1.5", "-1", "300 "]) assert.deepEqual(problems({ ...hot, ZECEIPT_RATE_MAX_DRIFT_BPS: bad }), ["ZECEIPT_RATE_MAX_DRIFT_BPS"], bad);
  assert.equal(configSummary(loadConfig(hot)).rateMaxDriftBps, 300);
});

test("wrap keys: 32 bytes each, strict base64, unique well-formed ids; the last one seals", () => {
  const w = (v: string) => problems({ ...hot, ZECEIPT_WRAP_KEYS: v });
  assert.deepEqual(w(`k1:${Buffer.alloc(31).toString("base64")}`), ["ZECEIPT_WRAP_KEYS"], "31 bytes");
  assert.deepEqual(w(`k1:${Buffer.alloc(33).toString("base64")}`), ["ZECEIPT_WRAP_KEYS"], "33 bytes");
  assert.deepEqual(w(`k1:${K1}!!`), ["ZECEIPT_WRAP_KEYS"], "junk after base64");
  assert.deepEqual(w(`k1:${K1},k1:${K2}`), ["ZECEIPT_WRAP_KEYS"], "duplicate id");
  assert.deepEqual(w(`:${K1}`), ["ZECEIPT_WRAP_KEYS"], "empty id");
  assert.deepEqual(w(`a.b:${K1}`), ["ZECEIPT_WRAP_KEYS"], "bad id");
  assert.deepEqual(w(`${"k".repeat(33)}:${K1}`), ["ZECEIPT_WRAP_KEYS"], "id longer than 32");
  assert.deepEqual(w(`${"k".repeat(32)}:${K1}`), [], "id of exactly 32");
  assert.deepEqual(w(K1), ["ZECEIPT_WRAP_KEYS"], "no id");
  assert.deepEqual(w(`k1:${K1},`), ["ZECEIPT_WRAP_KEYS"], "trailing comma");
  assert.deepEqual(w(`k1:${K1.replace(/=+$/, "")}`), [], "unpadded base64 is fine");
  assert.equal(loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `old:${K2},new:${K1}` }).wrapKeys.at(-1)?.kid, "new");
});

test("no secret appears in errors, the summary, or any ordinary handling of the config", async () => {
  const { inspect } = await import("node:util");
  const secretB64 = Buffer.alloc(32, 0x5c).toString("base64");
  const secretHex = Buffer.alloc(32, 0x5c).toString("hex");
  const good = loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `k1:${secretB64}` });
  const bytesAsNumbers = [...Buffer.alloc(32, 0x5c)].slice(0, 8).join(",");
  const outputs = [
    JSON.stringify(good),
    JSON.stringify({ ...good }),
    JSON.stringify(good.wrapKeys),
    JSON.stringify(structuredClone(good)),
    inspect(good, { depth: 20 }),
    inspect(good.wrapKeys, { depth: 20, showHidden: true }),
    `${good.wrapKeys[0].key}`,
    String(good.wrapKeys[0].key),
    JSON.stringify(configSummary(good)),
    inspect(keyringFromConfig(good), { depth: 20, showHidden: true }),
    JSON.stringify(keyringFromConfig(good)),
  ];
  // A malformed wrap-key value (one byte short) must not be echoed either.
  const shortB64 = Buffer.alloc(31, 0x5c).toString("base64");
  try {
    loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `k1:${shortB64}`, ZECEIPT_ZKOOL_URL: `http://user:${secretB64}@x` + "\u0000" });
  } catch (e) {
    outputs.push(String(e), (e as Error).message, JSON.stringify(e), JSON.stringify((e as ConfigError).problems));
  }
  // A key written where the id belongs (reversed order), or repeated, must not be echoed as a "key id".
  const urlSafe = Buffer.alloc(32, 0x5c).toString("base64url").replace(/=+$/, "");
  assert.equal(urlSafe.length, 43, "a 32-byte key is 43 characters of base64url, longer than any key id");
  for (const v of [`${urlSafe}:k1`, `k1:${secretB64},k1:${secretB64}`, `${urlSafe}:${urlSafe}`, `${urlSafe}:${secretB64}`]) {
    try {
      loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: v });
      assert.fail(`accepted ${v.slice(0, 4)}…`);
    } catch (e) {
      outputs.push(String(e), JSON.stringify((e as ConfigError).problems));
    }
  }
  for (const o of outputs) {
    for (const needle of [secretB64, secretB64.slice(0, 20), shortB64.slice(0, 20), secretHex, urlSafe.slice(0, 20), bytesAsNumbers]) {
      assert.ok(!o.includes(needle), `leaked in: ${o.slice(0, 80)}`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(good)).wrapKeys, [{ kid: "k1", key: "[redacted]" }]);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...good })).wrapKeys, [{ kid: "k1", key: "[redacted]" }]);
  assert.deepEqual(configSummary(good).wrapKeyIds, ["k1"]);
});

test("one owner: no production file other than lib/config/env.ts mentions ZECEIPT_* (catches process.env reads, destructuring and indirection alike)", () => {
  const root = resolve(import.meta.dirname, "..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && p !== join(root, "lib/config/env.ts") && /ZECEIPT_/.test(readFileSync(p, "utf8"))) hits.push(p.slice(root.length + 1));
    }
  };
  walk(join(root, "lib"));
  walk(join(root, "db"));
  try {
    walk(join(root, "app"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // app/ arrives with slice C2
  }
  // Root-level config files (next.config.ts, drizzle.config.ts, instrumentation.ts, …) count too.
  for (const name of readdirSync(root)) {
    if (/\.(ts|mts|js|mjs)$/.test(name) && /ZECEIPT_/.test(readFileSync(join(root, name), "utf8"))) hits.push(name);
  }
  assert.deepEqual(hits, []);
});

test(".env.example documents exactly the known variables and parses once its placeholder key is filled", () => {
  const text = readFileSync(resolve(import.meta.dirname, "../.env.example"), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  assert.ok(env.ZECEIPT_WRAP_KEYS.includes("REPLACE"), "the committed key is a placeholder, never a real key");
  env.ZECEIPT_WRAP_KEYS = `k1:${K1}`;
  const c = loadConfig(env);
  assert.equal(c.custody.mode, "hot");
  assert.equal(c.network, "regtest");
});
