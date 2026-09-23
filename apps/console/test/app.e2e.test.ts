// Build-and-serve (slice C2): `next build` needs no ZECEIPT_* variables; `next start` boots once and serves
// /api/health; a bad configuration or database path makes `next start` exit with code 1 before serving,
// naming variables but never the key (REQ-CON-17 "fails startup"). Opt-in (a production build takes a
// while): ZECEIPT_APP_E2E=1 node --test test/app.e2e.test.ts

import http from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { APP, NEXT, baseEnv, children, formFields, multipart, raw, start, waitHealthy, within } from "./helpers/app-server.ts";

const RUN = process.env.ZECEIPT_APP_E2E === "1";
// The JavaScript path in a real browser (the system Chrome through playwright-core; no browser download).
const BROWSER = RUN && process.env.ZECEIPT_BROWSER_E2E === "1";
const KEY = Buffer.alloc(32, 0x5c);
const KEY_B64 = KEY.toString("base64");
const dir = mkdtempSync(join(tmpdir(), "zeceipt-app-"));
// A fake of Kraken's Ticker for every server (ZECEIPT_RATE_URL): submit needs a lock and re-quotes (slice G2b1).
// It answers a steady 1600.00, so a lock and the execution quote agree; the rate test brings its own source.
const defaultTicker = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1601.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } })));
let defaultTickerUrl = "";

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
    ZECEIPT_RATE_URL: defaultTickerUrl,
    ...extra,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e as Record<string, string>;
};
const assertNoKey = (text: string) => {
  for (const needle of [KEY_B64, KEY_B64.slice(0, 20), KEY.toString("base64url").slice(0, 20), KEY.toString("hex"), [...KEY].slice(0, 8).join(",")]) {
    assert.ok(!text.includes(needle), `key material in output: ${text.slice(0, 200)}`);
  }
};

/**
 * Send the head (and optional first bytes) of a request on a raw socket, then stall with the socket open:
 * resolves with the status line and how long the server took, or null if nothing came back in `waitMs`.
 */
function stalled(port: number, head: string, first: Buffer | undefined, waitMs: number) {
  return new Promise<{ line: string; ms: number } | null>((ok, fail) => {
    const t0 = Date.now();
    const sock = connect(port, "127.0.0.1", () => {
      sock.write(head);
      if (first) sock.write(first);
    });
    const timer = setTimeout(() => {
      sock.destroy();
      ok(null);
    }, waitMs);
    sock.once("data", (d) => {
      clearTimeout(timer);
      sock.destroy();
      ok({ line: d.toString("latin1").split("\r\n")[0], ms: Date.now() - t0 });
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
  });
}


before(async () => {
  if (!RUN) return;
  await new Promise<void>((r) => defaultTicker.listen(0, "127.0.0.1", r));
  defaultTickerUrl = `http://127.0.0.1:${(defaultTicker.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD`;
  const b = spawnSync(process.execPath, [NEXT, "build"], { cwd: APP, env: baseEnv() as NodeJS.ProcessEnv, encoding: "utf8", timeout: 300_000 });
  assert.equal(b.status, 0, `next build failed without ZECEIPT_* variables:\n${b.stdout}\n${b.stderr}`);
});
after(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  defaultTicker.close();
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

test("guard and batch routes through next start: foreign Host and cross-site writes refused everywhere; same-origin create and read; oversize bodies refused while arriving", { skip: !RUN }, async () => {
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

  // An oversize body is refused while it is still arriving, not after the client finishes (review D1
  // round 1: behind proxy.ts, Next read the whole upload first). Both requests stall with the socket open.
  const head = (framing: string) => `POST /api/batches HTTP/1.1\r\nHost: ${self}\r\nContent-Type: application/json\r\n${framing}\r\n\r\n`;
  const declared = await stalled(s.port, head("Content-Length: 9000000"), undefined, 5_000);
  assert.ok(declared, "a declared 9 MB body with nothing sent got no answer within 5 s");
  assert.match(declared.line, /^HTTP\/1\.1 413 /);
  assert.ok(declared.ms < 2_000, `declared oversize answered after ${declared.ms} ms`);
  const chunks304k = Buffer.concat(Array.from({ length: 19 }, () => Buffer.concat([Buffer.from("4000\r\n"), Buffer.alloc(16384, 0x20), Buffer.from("\r\n")])));
  const streaming = await stalled(s.port, head("Transfer-Encoding: chunked"), chunks304k, 5_000);
  assert.ok(streaming, "a chunked body stalled after 304 KiB got no answer within 5 s");
  assert.match(streaming.line, /^HTTP\/1\.1 413 /);
  assert.ok(streaming.ms < 2_000, `chunked oversize answered after ${streaming.ms} ms`);
  assertNoKey(s.output());
  s.child.kill("SIGTERM");
  await within(s.exited, 10_000, "shutdown");
});

test("submit and status through next start: pays once against a fake wallet, replays, and follows the chain", { skip: !RUN }, async () => {
  const fake = await new FakeZkool().start();
  let fakeStopped = false;
  // The real zeceipt binary, so receipt issuance spawns it from inside Next's bundled server (slice D3).
  const bin = process.env.ZECEIPT_BIN ?? resolve(APP, "../../target/debug/zeceipt");
  const s = await start(demoEnv("submit", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_BIN: bin, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1" }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, "content-type": "application/json", origin: `http://${self}`, "sec-fetch-site": "same-origin" };
    const draft = JSON.stringify({ title: "pay", items: [{ payableId: "p1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000", memo: "PAY-1" }] });
    const id = (JSON.parse((await raw(s.port, "POST", "/api/batches", same, draft)).body) as { id: string }).id;
    assert.equal((JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string }).state, "draft");
    // Submit requires a rate lock (REQ-CON-21, slice G2b1): lock through the API, from the default fake ticker.
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/rate-lock`, { host: self, origin: `http://${self}` })).status, 201);

    // Pages (slice E1): the list, and the batch at draft, read through the library on each request.
    // React separates adjacent text nodes with <!-- --> in server HTML; read the page as its text.
    const page = async (path: string) => {
      const r = await raw(s.port, "GET", path, { host: self });
      return { ...r, body: r.body.replaceAll("<!-- -->", "") };
    };
    const list = await page("/");
    assert.equal(list.status, 200);
    for (const text of [">pay<", "Payment mode", "Loopback only, no sign-in yet"]) assert.ok(list.body.includes(text), `list shows ${text}`);
    // The amount is one visible string over two spans (the last five decimals lighter, slice G1d).
    assert.ok(list.body.replace(/<[^>]+>/g, "").includes("0.00001000 ZEC"), "list shows the total with 8 decimals");
    const draftPage = await page(`/batches/${id}`);
    assert.equal(draftPage.status, 200);
    for (const text of ["Draft", "Not submitted. Nothing has been paid.", "Submit the batch (with its total)", "Zkool, account 9", "Regtest (local test chain)", "PAY-1", "Total"]) {
      assert.ok(draftPage.body.includes(text), `draft page shows ${text}`);
    }
    assert.ok(!/\bConfirmed \(/.test(draftPage.body) && !draftPage.body.includes("Receipts issued<"), "no confirmed claim on a draft");
    assert.equal((await page("/batches/0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f")).status, 404);
    assert.equal((await page("/batches/not-an-id")).status, 404);
    assert.equal((await raw(s.port, "GET", `/batches/${id}`, { host: "evil.example" })).status, 403);

    // A cross-site submit is refused before anything runs.
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/submit`, { ...same, origin: "http://evil.example" }, '{"confirmTotalZat":"1000"}')).status, 403);
    assert.equal(fake.payCalls, 0);

    // A wallet refusal is mapped by class inside the app bundle. Before slice E1 the backend was built in
    // the instrumentation bundle, whose error classes the app's instanceof never matched: this answered 500.
    const refusedDraft = JSON.stringify({ title: "refused", items: [{ payableId: "r1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000", memo: "REFUSED-1" }] });
    const refusedId = (JSON.parse((await raw(s.port, "POST", "/api/batches", same, refusedDraft)).body) as { id: string }).id;
    assert.equal((await raw(s.port, "POST", `/api/batches/${refusedId}/rate-lock`, { host: self, origin: `http://${self}` })).status, 201);
    // An unlocked batch is refused before the wallet, through the bundled server (mapped by code, E1).
    const unlockedId = (JSON.parse((await raw(s.port, "POST", "/api/batches", same, JSON.stringify({ title: "unlocked", items: [{ payableId: "u1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000", memo: "UNLOCKED-1" }] }))).body) as { id: string }).id;
    const unlocked = await raw(s.port, "POST", `/api/batches/${unlockedId}/submit`, same, '{"confirmTotalZat":"1000"}');
    assert.deepEqual([unlocked.status, (JSON.parse(unlocked.body) as { code: string }).code, (JSON.parse(unlocked.body) as { thisRequest: string }).thisRequest], [409, "rate_not_locked", "sent_nothing"]);
    assert.equal(fake.payCalls, 0);
    fake.nextPay = "refused";
    const refused = await raw(s.port, "POST", `/api/batches/${refusedId}/submit`, same, '{"confirmTotalZat":"1000"}');
    assert.equal(refused.status, 409, refused.body);
    assert.deepEqual([(JSON.parse(refused.body) as { code: string }).code, (JSON.parse(refused.body) as { thisRequest: string }).thisRequest], ["payment_rejected", "sent_nothing"]);
    const paysBefore = fake.payCalls;

    const first = await raw(s.port, "POST", `/api/batches/${id}/submit`, same, '{"confirmTotalZat":"1000"}');
    assert.equal(first.status, 202, first.body);
    const txid = (JSON.parse(first.body) as { txid: string }).txid;
    const again = await raw(s.port, "POST", `/api/batches/${id}/submit`, same, '{"confirmTotalZat":"1000"}');
    assert.equal(again.status, 202);
    assert.deepEqual(JSON.parse(again.body), { batchId: id, txid, replayed: true, via: "record", status: `/api/batches/${id}/status` });
    assert.equal(fake.payCalls, paysBefore + 1, "one payment for two submits");

    assert.equal((JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string }).state, "pending");
    const pendingPage = await page(`/batches/${id}`);
    for (const text of ["Broadcast, not in a block yet", "Not confirmed.", txid]) assert.ok(pendingPage.body.includes(text), `pending page shows ${text}`);
    fake.mine(2);
    const st = JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string; detail: { txid: string } };
    assert.deepEqual([st.state, st.detail.txid], ["confirmed", txid]);
    const confirmedPage = await page(`/batches/${id}`);
    for (const text of ["Confirmed", "Paid and confirmed on chain", "3 (3 required)", "Issue receipts", "No receipts yet"]) assert.ok(confirmedPage.body.includes(text), `confirmed page shows ${text}`);

    // Receipts: none yet; issuing spawns the CLI, which cannot reach lightwalletd here, so nothing is
    // recorded and the problem quotes nothing (the live path is the regtest e2e, slice E).
    assert.deepEqual(JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/receipts`, { host: self })).body), { batchId: id, receipts: [] });
    const issued = await raw(s.port, "POST", `/api/batches/${id}/receipts`, { host: self, origin: `http://${self}` });
    assert.equal(issued.status, 502, issued.body);
    assert.equal((JSON.parse(issued.body) as { code: string }).code, "issuance_failed");
    assert.ok(!issued.body.includes("127.0.0.1:1") && !issued.body.includes(bin));
    assert.deepEqual(JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/receipts`, { host: self })).body), { batchId: id, receipts: [] });

    // The wallet goes away: the page still renders the batch and claims nothing about the payment.
    await fake.stop();
    fakeStopped = true;
    const downPage = await page(`/batches/${id}`);
    assert.equal(downPage.status, 200);
    for (const text of ["Status unavailable", "The payment was broadcast, but the wallet did not answer", "Do not pay this batch by hand", "PAY-1", "Payment mode", "Total"]) {
      assert.ok(downPage.body.includes(text), `wallet-down page shows ${text}`);
    }
    assert.ok(!downPage.body.includes("Paid and confirmed on chain"), "no confirmed claim while the wallet is down");
    assert.equal((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).status, 502);
    assertNoKey(s.output());
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    if (!fakeStopped) await fake.stop();
  }
});


test("page actions through next start, posted as a browser without JavaScript: pay once, never twice, receipts offered after confirmation", { skip: !RUN }, async () => {
  const fake = await new FakeZkool().start();
  const bin = process.env.ZECEIPT_BIN ?? resolve(APP, "../../target/debug/zeceipt");
  const s = await start(demoEnv("actions", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_BIN: bin, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1" }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const draft = JSON.stringify({ title: "actions", items: [{ payableId: "a1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "2500", memo: "ACT-1" }] });
    const id = (JSON.parse((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, draft)).body) as { id: string }).id;
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/rate-lock`, same)).status, 201, "locked (submit requires it, slice G2b1)");
    const text = async () => (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body.replaceAll("<!-- -->", "");
    const state = async () => (JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string }).state;

    // Draft: Pay (naming the amount) is offered, Issue is not.
    const draftPage = await text();
    assert.ok(draftPage.includes("Pay 0.00002500 ZEC"), "the button names the amount");
    assert.ok(!draftPage.includes(">Issue receipts</button>"));
    const pay = multipart(formFields(draftPage, 'name="confirmTotalZat"'));

    // A failing post (a wrong total) keeps the form on the page with its result, and answers promptly: with a
    // bound action this exact case spun the server at 100% CPU (see actions.ts).
    const wrong = multipart(formFields(draftPage, 'name="confirmTotalZat"').map(([k, v]) => [k, k === "confirmTotalZat" ? "1" : v] as [string, string]));
    const t0 = Date.now();
    const refusedPay = await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": wrong.type }, wrong.body);
    assert.equal(refusedPay.status, 200);
    assert.ok(Date.now() - t0 < 5_000, `answered in ${Date.now() - t0} ms`);
    assert.ok(refusedPay.body.replaceAll("<!-- -->", "").includes("does not equal this batch"), "the failure is shown with its form");
    assert.equal(fake.payCalls, 0);

    // A cross-site post of the same form is refused before anything runs.
    const cross = await raw(s.port, "POST", `/batches/${id}`, { host: self, origin: "http://evil.example", "content-type": pay.type }, pay.body);
    assert.equal(cross.status, 403);
    assert.equal(fake.payCalls, 0);

    const paid = await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": pay.type }, pay.body);
    assert.equal(paid.status, 200, paid.body.slice(0, 300));
    assert.equal(fake.payCalls, 1, "one payment");
    assert.equal(await state(), "pending");
    // On success the next action is no longer "submit", so the Pay form (and its result line) leaves the page;
    // the re-rendered status is the confirmation. The action's result still travels in the response payload.
    const afterPay = paid.body.replaceAll("<!-- -->", "");
    assert.ok(afterPay.includes("Broadcast, not in a block yet") && !afterPay.includes("Pay 0.00002500 ZEC"), "the page shows the new status");
    assert.ok(afterPay.includes('"headline":"Broadcast"'), "the action's outcome is in the payload");

    // The same form posted again (a double submit, or a replayed request) pays nothing more.
    const again = await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": pay.type }, pay.body);
    assert.equal(again.status, 200);
    assert.equal(fake.payCalls, 1, "never twice");

    // Pending: no action. Confirmed: Issue is offered, Pay is not.
    const pendingPage = await text();
    assert.ok(!pendingPage.includes("Pay 0.00002500 ZEC") && !pendingPage.includes(">Issue receipts</button>"));
    fake.mine(2);
    const confirmedPage = await text();
    assert.ok(confirmedPage.includes(">Issue receipts</button>") && !confirmedPage.includes("Pay 0.00002500 ZEC"));
    const issue = multipart(formFields(confirmedPage, "Issue receipts"));
    const issued = await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": issue.type }, issue.body);
    assert.equal(issued.status, 200);
    // No lightwalletd here: the issuer fails, the page says so in the API's words, nothing is recorded.
    assert.ok(issued.body.includes("zeceipt issue failed or its receipts do not match the batch"), "the failure is shown");
    assert.deepEqual(JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/receipts`, { host: self })).body), { batchId: id, receipts: [] });
    assertNoKey(s.output());
  } finally {
    s.child.kill("SIGTERM");
    // A server stuck in a request ignores SIGTERM (Next waits for it): never let cleanup hang the suite.
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    await fake.stop();
  }
});

test("rate lock from the batch page, posted as a browser without JavaScript: lock, re-lock, the source failing keeps the lock, and no form once paid (slice G1c2)", { skip: !RUN }, async () => {
  // A fake of Kraken's Ticker (ZECEIPT_RATE_URL): each step sets its answer.
  let tick: { status: number; body: string } = { status: 200, body: "" };
  const ticker = (bid: string, ask: string, last: string) => ({ status: 200, body: JSON.stringify({ error: [], result: { XZECZUSD: { a: [ask, "1", "1.000"], b: [bid, "1", "1.000"], c: [last, "0.1"] } } }) });
  const source = http.createServer((_req, res) => void res.writeHead(tick.status, { "content-type": "application/json" }).end(tick.body));
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  const fake = await new FakeZkool().start();
  const s = await start(demoEnv("rates", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD` }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const draft = JSON.stringify({ title: "rates", items: [
      { payableId: "r1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "RATE-1" },
      { payableId: "r2", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "50000", memo: "RATE-2" },
    ] });
    const id = (JSON.parse((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, draft)).body) as { id: string }).id;
    const page = async () => (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body.replaceAll("<!-- -->", "");
    const post = async (html: string, marker: string, headers: Record<string, string> = same) => {
      const f = multipart(formFields(html, marker));
      return raw(s.port, "POST", `/batches/${id}`, { ...headers, "content-type": f.type }, f.body);
    };

    const before = await page();
    assert.ok(before.includes("Not locked.") && before.includes(">Lock rate</button>") && !before.includes("USD at lock"), "unlocked: the form, no USD column");

    // Lock: the page shows the rate (bid), its source and time, and USD at the lock beside each amount and the total.
    tick = ticker("1610.95000", "1611.71000", "1611.35000");
    const locked = await post(before, ">Lock rate</button>");
    assert.equal(locked.status, 200);
    const after = (await page());
    assert.ok(after.includes("1 ZEC = $1,610.95") && after.includes("(bid, exactly 1610.95000)"), "the rate and its exact bid");
    assert.ok(after.includes("Kraken XZECZUSD · ask 1611.71000 · last trade 1611.35000") && / UTC</.test(after), "its source and time");
    assert.ok(after.includes("USD at lock"), "the USD column");
    // 1.01 ZEC → 1627.0595 → $1,627.06; 0.0005 ZEC → 0.805475 → $0.81; total 1.0105 ZEC → 1627.864975 → $1,627.86.
    // The total is rounded once: the sum of the rounded parts would be $1,627.87, a cent off.
    assert.ok(after.includes("$1,627.06") && after.includes("$0.81") && after.includes("$1,627.86") && !after.includes("$1,627.87"), "exact per item, and the total rounded once");
    assert.ok(after.includes(">Re-lock rate</button>"));

    // A cross-site post of the form is refused before the source is asked.
    tick = ticker("9.00", "9.01", "9.00");
    assert.equal((await post(after, ">Re-lock rate</button>", { host: self, origin: "http://evil.example" })).status, 403);
    assert.ok((await page()).includes("1 ZEC = $1,610.95"), "unchanged");

    // The source failing: "Not locked" with the reason, and the previous lock stays.
    tick = { status: 503, body: "busy" };
    const failed = (await post(after, ">Re-lock rate</button>")).body.replaceAll("<!-- -->", "");
    assert.ok(failed.includes("Not locked:") && failed.includes("(http)"), "the outcome says nothing was locked, and why");
    assert.ok((await page()).includes("1 ZEC = $1,610.95"), "the previous lock stays");

    // Re-lock: the new rate becomes current.
    tick = ticker("1600.10", "1600.90", "1600.50");
    await post(await page(), ">Re-lock rate</button>");
    assert.ok((await page()).includes("1 ZEC = $1,600.10"));

    // The wallet refuses an attempt (nothing paid): the batch keeps its Re-lock form (review G2b1: the page
    // followed isSubmitted and hid it, while the API allows the lock, migration 0014).
    fake.nextPay = "refused";
    const walletRefused = (await post(await page(), 'name="confirmTotalZat"')).body.replaceAll("<!-- -->", "");
    assert.ok(walletRefused.includes("This request sent nothing."), "refused before building");
    const afterRefusal = await page();
    assert.ok(afterRefusal.includes(">Re-lock rate</button>") && !afterRefusal.includes("its rate can no longer be changed"), "a refused batch keeps its Re-lock form");

    // Paid: the batch is frozen, so the form leaves the page and the page says why; the lock stays shown.
    const toPay = await page();
    assert.equal((await post(toPay, 'name="confirmTotalZat"')).status, 200);
    assert.equal(fake.payCalls, 2, "the refused call, then the payment");
    const frozen = await page();
    assert.ok(!frozen.includes("Re-lock rate</button>") && frozen.includes("its rate can no longer be changed") && frozen.includes("1 ZEC = $1,600.10"));
    // A stale page's post still reaches the handler, which refuses it (409 batch_frozen) and says so.
    const stale = (await post(toPay, ">Re-lock rate</button>")).body.replaceAll("<!-- -->", "");
    assert.ok(stale.includes("its rate can no longer be locked"), "the stale post is refused with the reason");
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    await fake.stop();
    await new Promise((r) => source.close(r));
  }
});

test("create-draft form through next start, posted as a browser without JavaScript: 303 to the new batch; errors next to their lines with values kept", { skip: !RUN }, async () => {
  const s = await start(demoEnv("draft-form"));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const page = (await raw(s.port, "GET", "/batches/new", { host: self })).body;
    assert.ok(page.includes("uregtest1… (unified address)") && page.includes('name="lines.2.memo"'), "three blank lines and the network's address hint");
    const hidden = formFields(page, 'name="title"');
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const lineFields = (n: number, l: Record<string, string>) => ["payableId", "label", "address", "amount", "memo"].map((k) => [`lines.${n}.${k}`, l[k] ?? ""] as [string, string]);
    const count = async () => (JSON.parse((await raw(s.port, "GET", "/api/batches", { host: self })).body) as { batches: unknown[] }).batches.length;

    // Invalid: a bad address on line 1, a duplicate memo on line 3 (line 2 blank): 200, errors by line, values kept.
    const bad = multipart([...hidden, ["title", "Bad batch"], ...lineFields(0, { payableId: "p1", address: "not-an-address", amount: "0.5", memo: "M" }), ...lineFields(1, {}), ...lineFields(2, { payableId: "p2", address: UA, amount: "0.25", memo: "M" })]);
    const refused = await raw(s.port, "POST", "/batches/new", { ...same, "content-type": bad.type }, bad.body);
    assert.equal(refused.status, 200);
    const text = refused.body.replaceAll("<!-- -->", "");
    assert.ok(/Line 1: [^<]*/.test(text), "line 1 has its error");
    assert.ok(/Line 3: [^<]*appears twice/.test(text), "the duplicate memo is on line 3 (after the blank line 2)");
    assert.ok(text.includes('value="not-an-address"') && text.includes('value="Bad batch"'), "the entered values are kept");
    assert.equal(await count(), 0, "nothing was created");

    // A cross-site post is refused before anything runs.
    const ok = multipart([...hidden, ["title", "October"], ...lineFields(0, { payableId: "p1", label: "Alice", address: UA, amount: "0.25", memo: "OCT-1" }), ...lineFields(1, {}), ...lineFields(2, { payableId: "p2", address: UA, amount: "1.00000001", memo: "OCT-2" })]);
    assert.equal((await raw(s.port, "POST", "/batches/new", { host: self, origin: "http://evil.example", "content-type": ok.type }, ok.body)).status, 403);
    assert.equal(await count(), 0);

    // Valid: 303 to the new batch; the API confirms the items and exact zatoshi.
    const created = await raw(s.port, "POST", "/batches/new", { ...same, "content-type": ok.type }, ok.body);
    assert.equal(created.status, 303, created.body.slice(0, 200));
    const id = /^\/batches\/([0-9a-f-]{36})$/.exec(created.location ?? "")?.[1];
    assert.ok(id, `redirected to ${created.location}`);
    const batch = JSON.parse((await raw(s.port, "GET", `/api/batches/${id}`, { host: self })).body) as { title: string; items: { payableId: string; label: string; zat: string; memo: string }[] };
    assert.equal(batch.title, "October");
    assert.deepEqual(batch.items.map((i) => [i.payableId, i.label, i.zat, i.memo]), [["p1", "Alice", "25000000", "OCT-1"], ["p2", "", "100000001", "OCT-2"]]);
    assertNoKey(s.output());
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("create-draft form in a real browser (JavaScript): Remove takes the line clicked, errors move with their line", { skip: !BROWSER }, async () => {
  const { chromium } = await import("playwright-core");
  const s = await start(demoEnv("browser"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await waitHealthy(s.port, s.child, s.output);
    const base = `http://127.0.0.1:${s.port}`;
    const page = await browser.newPage();
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const fillLine = async (n: number, v: { id: string; payee: string; amount: string; memo: string }) => {
      await page.getByLabel(`Line ${n} Payable id`).fill(v.id);
      await page.getByLabel(`Line ${n} Payee`).fill(v.payee);
      await page.getByLabel(`Line ${n} Address`).fill(UA);
      await page.getByLabel(`Line ${n} Amount (ZEC)`).fill(v.amount);
      await page.getByLabel(`Line ${n} Memo`).fill(v.memo);
    };
    const payees = async () => Promise.all([1, 2, 3].map(async (n) => ((await page.getByLabel(`Line ${n} Payee`).count()) ? page.getByLabel(`Line ${n} Payee`).inputValue() : null)));

    // The reviewer's reproduction: three payees, remove the first, create: Alice must be the one removed.
    await page.goto(`${base}/batches/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Title").fill("Browser batch");
    await fillLine(1, { id: "A-1", payee: "Alice", amount: "1.1", memo: "A" });
    await fillLine(2, { id: "B-1", payee: "Bob", amount: "2.2", memo: "B" });
    await fillLine(3, { id: "C-1", payee: "Carol", amount: "3.3", memo: "C" });
    await page.getByRole("button", { name: "Remove line 1" }).click();
    assert.deepEqual(await payees(), ["Bob", "Carol", null]);
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const id = page.url().split("/").pop()!;
    const batch = JSON.parse((await raw(s.port, "GET", `/api/batches/${id}`, { host: `127.0.0.1:${s.port}` })).body) as { items: { payableId: string; label: string; zat: string }[] };
    assert.deepEqual(batch.items.map((i) => [i.payableId, i.label, i.zat]), [["B-1", "Bob", "220000000"], ["C-1", "Carol", "330000000"]]);

    // An error belongs to its line: a bad amount on line 2 (Bob), then remove line 1: the error is on Bob's row.
    await page.goto(`${base}/batches/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Title").fill("Errors travel");
    await fillLine(1, { id: "A-2", payee: "Alice", amount: "1", memo: "A2" });
    await fillLine(2, { id: "B-2", payee: "Bob", amount: "1.123456789", memo: "B2" });
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.getByText("Line 2: amount: a ZEC amount with at most 8 decimal places").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Remove line 1" }).click();
    assert.equal(await page.getByLabel("Line 1 Payee").inputValue(), "Bob");
    await page.getByText("Line 1: amount: a ZEC amount with at most 8 decimal places").waitFor({ timeout: 5_000 });
    assert.equal(await page.getByText("Line 2: amount").count(), 0, "no error left on another line");
    assertNoKey(s.output());
  } finally {
    await browser.close();
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});
