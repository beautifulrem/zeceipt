// Build-and-serve (slice C2): `next build` needs no ZECEIPT_* variables; `next start` boots once and serves
// /api/health; a bad configuration or database path makes `next start` exit with code 1 before serving,
// naming variables but never the key (REQ-CON-17 "fails startup"). Opt-in (a production build takes a
// while): ZECEIPT_APP_E2E=1 node --test test/app.e2e.test.ts

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUN = process.env.ZECEIPT_APP_E2E === "1";
const APP = resolve(import.meta.dirname, "..");
const NEXT = join(APP, "node_modules", "next", "dist", "bin", "next");
const KEY = Buffer.alloc(32, 0x5c);
const KEY_B64 = KEY.toString("base64");
const dir = mkdtempSync(join(tmpdir(), "zeceipt-app-"));
const children: ChildProcess[] = [];

/** The parent environment without any ZECEIPT_* variable (the opt-in flag itself would be refused as unknown). */
const baseEnv = (): Record<string, string> => {
  const e: Record<string, string> = { NEXT_TELEMETRY_DISABLED: "1" };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ZECEIPT_")) e[k] = v;
  return e;
};
const demoEnv = (name: string, extra: Record<string, string | undefined> = {}) => {
  const e: Record<string, string | undefined> = {
    ...baseEnv(),
    ZECEIPT_CUSTODY_MODE: "hot",
    ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql",
    ZECEIPT_ZKOOL_ACCOUNT: "1",
    ZECEIPT_DB_PATH: join(dir, `${name}.db`),
    ZECEIPT_ORG_ID: "demo-org",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${KEY_B64}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
    ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
    ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
    ZECEIPT_ISSUER_KEY_ID: "2026-09",
    ...extra,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e as Record<string, string>;
};
const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
const assertNoKey = (text: string) => {
  for (const needle of [KEY_B64, KEY_B64.slice(0, 20), KEY.toString("base64url").slice(0, 20), KEY.toString("hex"), [...KEY].slice(0, 8).join(",")]) {
    assert.ok(!text.includes(needle), `key material in output: ${text.slice(0, 200)}`);
  }
};

async function start(env: Record<string, string>) {
  const port = await freePort();
  // Next's global types make NODE_ENV required on ProcessEnv; Next sets it itself in the child.
  const child = spawn(process.execPath, [NEXT, "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: APP, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
  return { port, child, exited, output: () => out };
}
const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`timed out: ${what}`)), ms).unref())]);

before(() => {
  if (!RUN) return;
  const b = spawnSync(process.execPath, [NEXT, "build"], { cwd: APP, env: baseEnv() as NodeJS.ProcessEnv, encoding: "utf8", timeout: 300_000 });
  assert.equal(b.status, 0, `next build failed without ZECEIPT_* variables:\n${b.stdout}\n${b.stderr}`);
});
after(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
});

test("next start boots once and serves a passing health check; / renders", { skip: !RUN }, async () => {
  const s = await start(demoEnv("serve"));
  let res: Response | undefined;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && s.child.exitCode === null) {
    try {
      res = await fetch(`http://127.0.0.1:${s.port}/api/health`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(res, `no response; output:\n${s.output()}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/health+json");
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await res.json(), { status: "pass", checks: { "sqlite:responsiveness": [{ status: "pass" }] } });

  const home = await fetch(`http://127.0.0.1:${s.port}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Zeceipt payout console/);
  assertNoKey(s.output());
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown");
});

for (const [name, extra, variable] of [
  ["external custody with a Zkool endpoint (REQ-CON-17)", { ZECEIPT_CUSTODY_MODE: "external" }, "ZECEIPT_ZKOOL_URL"],
  ["hot custody without a Zkool endpoint (REQ-CON-17)", { ZECEIPT_ZKOOL_URL: undefined }, "ZECEIPT_ZKOOL_URL"],
  ["a wrap key written where its id belongs", { ZECEIPT_WRAP_KEYS: `${KEY.toString("base64url")}:k1` }, "ZECEIPT_WRAP_KEYS"],
  ["a database path in a missing directory", { ZECEIPT_DB_PATH: join(dir, "missing", "x.db") }, "TypeError: Cannot open database"],
] as const) {
  test(`next start exits 1 before serving: ${name}`, { skip: !RUN }, async () => {
    const s = await start(demoEnv(`bad-${variable}`, extra as Record<string, string | undefined>));
    // Next prints "Ready" before register() runs; keep asking while it starts: no request may be answered.
    const answered: number[] = [];
    const probing = (async () => {
      while (s.child.exitCode === null) {
        try {
          answered.push((await fetch(`http://127.0.0.1:${s.port}/api/health`)).status);
        } catch {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    })();
    const code = await within(s.exited, 30_000, `exit (${name}); output:\n${s.output()}`);
    await probing;
    assert.equal(code, 1, s.output());
    assert.deepEqual(answered, [], "a request was answered before the failed boot exited");
    assert.match(s.output(), new RegExp(`startup refused: ${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assertNoKey(s.output());
  });
}
