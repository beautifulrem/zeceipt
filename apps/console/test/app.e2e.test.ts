// Build-and-serve (slice C2): `next build` needs no ZECEIPT_* variables; `next start` boots once and serves
// /api/health; a bad configuration or database path makes `next start` exit with code 1 before serving,
// naming variables but never the key (REQ-CON-17 "fails startup"). Opt-in (a production build takes a
// while): ZECEIPT_APP_E2E=1 node --test test/app.e2e.test.ts

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
/** A raw HTTP/1.1 request (fetch cannot set Host); a stream body is sent chunked, with no Content-Length. */
function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: string | Iterable<Buffer>) {
  return new Promise<{ status: number; type: string | undefined; body: string }>((ok, fail) => {
    const r = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: res.headers["content-type"], body: b }));
      res.on("error", fail);
    });
    r.on("error", fail);
    if (typeof body === "string") r.end(body);
    else if (body) {
      void (async () => {
        for (const chunk of body) {
          if (r.destroyed) return;
          if (!r.write(chunk)) await new Promise((res) => r.once("drain", res).once("close", res)); // respect backpressure
        }
        r.end();
      })();
    } else r.end();
  });
}
async function waitHealthy(port: number, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) return;
    } catch {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  assert.fail(`not healthy; output:\n${output()}`);
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

test("guard and batch routes through next start: foreign Host and cross-site writes refused everywhere; same-origin create and read", { skip: !RUN }, async () => {
  const s = await start(demoEnv("routes"));
  await waitHealthy(s.port, s.child, s.output);
  const self = `127.0.0.1:${s.port}`;
  const home = await raw(s.port, "GET", "/", { host: self });
  const chunk = /\/_next\/static\/[^"']+\.js/.exec(home.body)?.[0];
  assert.ok(chunk, "a static chunk is referenced by /");
  assert.equal((await raw(s.port, "GET", chunk, { host: self })).status, 200);

  // DNS rebinding: a foreign Host is refused on pages, API, static files and writes alike.
  for (const [method, path] of [["GET", "/"], ["GET", "/api/health"], ["GET", chunk], ["GET", "/api/batches"], ["POST", "/api/batches"]] as const) {
    const r = await raw(s.port, method, path, { host: "evil.example", "content-type": "application/json" }, method === "POST" ? "{}" : undefined);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.type, "application/problem+json");
    assert.equal((JSON.parse(r.body) as { code: string }).code, "host_not_allowed");
  }
  // Cross-site writes are refused before any handler runs.
  const draft = JSON.stringify({ title: "e2e", items: [{ payableId: "p1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000", memo: "E2E-1" }] });
  for (const h of [{ origin: "http://evil.example" }, { "sec-fetch-site": "cross-site" }, { origin: "null" }] as Record<string, string>[]) {
    const r = await raw(s.port, "POST", "/api/batches", { host: self, "content-type": "application/json", ...h }, draft);
    assert.equal(r.status, 403, JSON.stringify(h));
  }
  assert.equal((JSON.parse((await raw(s.port, "GET", "/api/batches", { host: self })).body) as { batches: unknown[] }).batches.length, 0, "nothing was created");

  // Same-origin create, then read it back.
  const created = await raw(s.port, "POST", "/api/batches", { host: self, "content-type": "application/json", origin: `http://${self}`, "sec-fetch-site": "same-origin" }, draft);
  assert.equal(created.status, 201, created.body);
  const id = (JSON.parse(created.body) as { id: string }).id;
  const got = await raw(s.port, "GET", `/api/batches/${id}`, { host: self });
  assert.equal(got.status, 200);
  assert.equal((JSON.parse(got.body) as { items: { zat: string }[] }).items[0].zat, "1000");
  assert.equal((await raw(s.port, "GET", "/api/batches/not-a-batch", { host: self })).status, 404);

  // A chunked body with no Content-Length is cut off at the ceiling (413), not read to the end.
  const big = (function* () {
    for (let i = 0; i < 40; i++) yield Buffer.alloc(16 * 1024, 0x20);
  })();
  const tooBig = await raw(s.port, "POST", "/api/batches", { host: self, "content-type": "application/json", "transfer-encoding": "chunked" }, big);
  assert.equal(tooBig.status, 413);
  assertNoKey(s.output());
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown");
});
