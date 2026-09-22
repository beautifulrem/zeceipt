// Console configuration (slice C1): REQ-CON-17's custody test, every variable's rules, all problems at
// once, no secret in any output, and the one-owner rule (only lib/config/env.ts reads ZECEIPT_* vars).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError, configSummary, loadConfig } from "../lib/index.ts";

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
  assert.deepEqual(Buffer.from(c.wrapKeys[1].key), Buffer.alloc(32, 0xb2));
  assert.equal(loadConfig({ ...hot, ZECEIPT_CONFIRMATIONS: "12" }).confirmations, 12);
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
  for (const [k, v] of [["CONFIRMATIONS", "101"], ["CONFIRMATIONS", "3.5"], ["ZKOOL_ACCOUNT", "1e3"], ["DB_PATH", "file:/x.db"], ["ORG_ID", "x".repeat(65)]] as const) {
    assert.deepEqual(problems({ ...hot, [`ZECEIPT_${k}`]: v }), [`ZECEIPT_${k}`], `${k}=${v}`);
  }
  assert.deepEqual(problems({ ...hot, ZECEIPT_ZKOOL_URL: "http://user:pw@127.0.0.1:9000/graphql" }), ["ZECEIPT_ZKOOL_URL"], "credentials in a URL");
  assert.deepEqual(problems({ ...hot, ZECEIPT_LIGHTWALLETD_URL: "https://user@lwd.example" }), ["ZECEIPT_LIGHTWALLETD_URL"], "user in a URL");
  const missing = problems({});
  assert.ok(missing.includes("ZECEIPT_CUSTODY_MODE") && missing.includes("ZECEIPT_WRAP_KEYS") && missing.includes("ZECEIPT_DB_PATH"));
});

test("wrap keys: 32 bytes each, strict base64, unique well-formed ids; the last one seals", () => {
  const w = (v: string) => problems({ ...hot, ZECEIPT_WRAP_KEYS: v });
  assert.deepEqual(w(`k1:${Buffer.alloc(31).toString("base64")}`), ["ZECEIPT_WRAP_KEYS"], "31 bytes");
  assert.deepEqual(w(`k1:${Buffer.alloc(33).toString("base64")}`), ["ZECEIPT_WRAP_KEYS"], "33 bytes");
  assert.deepEqual(w(`k1:${K1}!!`), ["ZECEIPT_WRAP_KEYS"], "junk after base64");
  assert.deepEqual(w(`k1:${K1},k1:${K2}`), ["ZECEIPT_WRAP_KEYS"], "duplicate id");
  assert.deepEqual(w(`:${K1}`), ["ZECEIPT_WRAP_KEYS"], "empty id");
  assert.deepEqual(w(`a.b:${K1}`), ["ZECEIPT_WRAP_KEYS"], "bad id");
  assert.deepEqual(w(K1), ["ZECEIPT_WRAP_KEYS"], "no id");
  assert.deepEqual(w(`k1:${K1},`), ["ZECEIPT_WRAP_KEYS"], "trailing comma");
  assert.deepEqual(w(`k1:${K1.replace(/=+$/, "")}`), [], "unpadded base64 is fine");
  assert.equal(loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `old:${K2},new:${K1}` }).wrapKeys.at(-1)?.kid, "new");
});

test("no secret appears in errors, the summary or the JSON form", () => {
  const secretB64 = Buffer.alloc(32, 0x5c).toString("base64");
  const secretHex = Buffer.alloc(32, 0x5c).toString("hex");
  const good = loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `k1:${secretB64}` });
  const outputs = [JSON.stringify(good), JSON.stringify(configSummary(good)), String(configSummary(good))];
  // A malformed wrap-key value (one byte short) must not be echoed either.
  const shortB64 = Buffer.alloc(31, 0x5c).toString("base64");
  try {
    loadConfig({ ...hot, ZECEIPT_WRAP_KEYS: `k1:${shortB64}`, ZECEIPT_ZKOOL_URL: `http://user:${secretB64}@x` + "\u0000" });
  } catch (e) {
    outputs.push(String(e), (e as Error).message, JSON.stringify(e), JSON.stringify((e as ConfigError).problems));
  }
  for (const o of outputs) {
    for (const needle of [secretB64, secretB64.slice(0, 20), shortB64.slice(0, 20), secretHex]) assert.ok(!o.includes(needle), `leaked in: ${o.slice(0, 80)}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(good)).wrapKeys, [{ kid: "k1", key: "[redacted]" }]);
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
  for (const d of ["lib", "db", "app"]) {
    try {
      walk(join(root, d));
    } catch {
      /* app/ does not exist yet */
    }
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
