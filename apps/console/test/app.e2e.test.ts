// Build-and-serve (slice C2): `next build` needs no ZECEIPT_* variables; `next start` boots once and serves
// /api/health; a bad configuration or database path makes `next start` exit with code 1 before serving,
// naming variables but never the key (REQ-CON-17 "fails startup"). Opt-in (a production build takes a
// while): ZECEIPT_APP_E2E=1 node --test test/app.e2e.test.ts

import http from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { autoIssue, batchDigest, batchNonce, getBatch, Keyring, openDb, recordReceipts, SqliteIdempotencyStore, toExecutionBatch, type AutoIssueResult } from "../lib/index.ts";
import { LINKABILITY_SPEC } from "../lib/view/linkability.ts";
import { item, ua } from "./helpers/ua-encoder.ts";
import { execFileSync } from "node:child_process";
import { APP, NEXT, baseEnv, children, formFields, multipart, raw, start, waitHealthy, within } from "./helpers/app-server.ts";
import { ZKOOL_PUBLIC_PEM, foreignZkoolToken, zkoolPublicKeyFile, zkoolTokenFile } from "./helpers/zkool-token.ts";

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
    ZECEIPT_ZKOOL_ACCOUNT: "1", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(1), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(),
    ZECEIPT_DB_PATH: join(dir, `${name}.db`),
    ZECEIPT_ORG_ID: "demo-org",
    ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${KEY_B64}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
    ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
    ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
    ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
    ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
    ZECEIPT_RATE_URL: defaultTickerUrl,
    // No receipt worker unless a test is about it (review I2 round 1): its passes would race the assertions.
    ZECEIPT_AUTO_RECEIPTS_SECONDS: "0",
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
  ["an admin Zkool token, every account (slice S3)", { ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(0) }, "ZECEIPT_ZKOOL_TOKEN_FILE"],
  ["a Zkool token file other users can read (slice S3)", { ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(1, {}, { mode: 0o644 }) }, "ZECEIPT_ZKOOL_TOKEN_FILE"],
  ["a Zkool token signed by another key (slice S3c)", { ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(1, {}, { text: foreignZkoolToken(1) }) }, "ZECEIPT_ZKOOL_TOKEN_FILE"],
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
    const tokenFile = (extra as { ZECEIPT_ZKOOL_TOKEN_FILE?: string }).ZECEIPT_ZKOOL_TOKEN_FILE;
    if (tokenFile) assert.ok(!s.output().includes(readFileSync(tokenFile, "utf8").trim().split(".")[2]), "the token is never printed");
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
  const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  let fakeStopped = false;
  // The real zeceipt binary, so receipt issuance spawns it from inside Next's bundled server (slice D3).
  const bin = process.env.ZECEIPT_BIN ?? resolve(APP, "../../target/debug/zeceipt");
  const s = await start(demoEnv("submit", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(), ZECEIPT_BIN: bin, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1", ZECEIPT_AUTO_RECEIPTS_SECONDS: "60" }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    // Slice I2 (REQ-CON-11): hot custody starts the automatic receipt worker from register().
    assert.match(s.output(), /receipts: automatic issuance every 60 s once a batch has \d+ confirmations/);
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
    // Slice I3: locked but not approved, the next step is to approve; the button names the total and the rate.
    for (const text of ["Draft", "Not approved and not submitted. Nothing has been paid.", "Approve the batch (its lines, total and locked rate)", "Approve paying 0.00001000 ZEC at 1 ZEC = $1,600.00", "Zkool, account 9", "Regtest (local test chain)", "PAY-1", "Total"]) {
      assert.ok(draftPage.body.includes(text), `draft page shows ${text}`);
    }
    assert.ok(!draftPage.body.includes("Pay 0.00001000 ZEC"), "no Pay before an approval");
    assert.ok(!/\bConfirmed \(/.test(draftPage.body) && !draftPage.body.includes("Receipts issued<"), "no confirmed claim on a draft");
    assert.equal((await page("/batches/0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f")).status, 404);
    assert.equal((await page("/batches/not-an-id")).status, 404);
    assert.equal((await raw(s.port, "GET", `/batches/${id}`, { host: "evil.example" })).status, 403);

    // A cross-site submit is refused before anything runs.
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/submit`, { ...same, origin: "http://evil.example" }, '{"confirmTotalZat":"1000"}')).status, 403);
    assert.equal(fake.payCalls, 0);
    // Slice I3, through the bundled server: unapproved, submit is refused before the wallet; a cross-site approve is
    // refused; approving names the total and the lock it saw.
    const unapproved = await raw(s.port, "POST", `/api/batches/${id}/submit`, same, '{"confirmTotalZat":"1000"}');
    assert.deepEqual([unapproved.status, (JSON.parse(unapproved.body) as { code: string }).code, (JSON.parse(unapproved.body) as { thisRequest: string }).thisRequest], [409, "not_approved", "sent_nothing"]);
    assert.equal(fake.payCalls, 0);
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/approve`, { ...same, origin: "http://evil.example" }, '{"confirmTotalZat":"1000","lockSeq":1}')).status, 403);
    const approved = await raw(s.port, "POST", `/api/batches/${id}/approve`, same, '{"confirmTotalZat":"1000","lockSeq":1}');
    assert.equal(approved.status, 201, approved.body);
    assert.equal((JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string }).state, "approved");

    // A wallet refusal is mapped by class inside the app bundle. Before slice E1 the backend was built in
    // the instrumentation bundle, whose error classes the app's instanceof never matched: this answered 500.
    const refusedDraft = JSON.stringify({ title: "refused", items: [{ payableId: "r1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000", memo: "REFUSED-1" }] });
    const refusedId = (JSON.parse((await raw(s.port, "POST", "/api/batches", same, refusedDraft)).body) as { id: string }).id;
    assert.equal((await raw(s.port, "POST", `/api/batches/${refusedId}/rate-lock`, { host: self, origin: `http://${self}` })).status, 201);
    assert.equal((await raw(s.port, "POST", `/api/batches/${refusedId}/approve`, same, '{"confirmTotalZat":"1000","lockSeq":1}')).status, 201);
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
  const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  const bin = process.env.ZECEIPT_BIN ?? resolve(APP, "../../target/debug/zeceipt");
  const s = await start(demoEnv("actions", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(), ZECEIPT_BIN: bin, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:1" }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const draft = JSON.stringify({ title: "actions", items: [{ payableId: "a1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "2500", memo: "ACT-1" }] });
    const id = (JSON.parse((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, draft)).body) as { id: string }).id;
    assert.equal((await raw(s.port, "POST", `/api/batches/${id}/rate-lock`, same)).status, 201, "locked (submit requires it, slice G2b1)");
    const text = async () => (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body.replaceAll("<!-- -->", "");
    const state = async () => (JSON.parse((await raw(s.port, "GET", `/api/batches/${id}/status`, { host: self })).body) as { state: string }).state;

    // Draft, locked: Approve (naming the amount and the rate) is offered, Pay is not (slice I3).
    const lockedPage = await text();
    assert.ok(lockedPage.includes("Approve paying 0.00002500 ZEC at 1 ZEC = $1,600.00") && !lockedPage.includes("Pay 0.00002500 ZEC"), "approve first");
    const approveForm = multipart(formFields(lockedPage, 'name="lockSeq"'));
    // A cross-site post of the approve form is refused before anything runs.
    assert.equal((await raw(s.port, "POST", `/batches/${id}`, { host: self, origin: "http://evil.example", "content-type": approveForm.type }, approveForm.body)).status, 403);
    assert.equal(await state(), "draft");
    const approvedPost = await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": approveForm.type }, approveForm.body);
    assert.equal(approvedPost.status, 200);
    assert.equal(await state(), "approved");

    // Approved: Pay (naming the amount) is offered, Issue is not.
    const draftPage = await text();
    assert.ok(draftPage.includes("Approved, not sent") && draftPage.includes("Pay 0.00002500 ZEC"), "the button names the amount");
    assert.ok(!draftPage.includes("Approve paying"), "approved: no second approval offered");
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
  const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  const s = await start(demoEnv("rates", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(), ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD` }));
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
    // Slice N1: this test's ticker is not Kraken, so the page names the host it answered from, never "Kraken".
    const tickerHost = `127.0.0.1:${(source.address() as { port: number }).port}`;
    assert.ok(after.includes(`Kraken-format quote from ${tickerHost} XZECZUSD · ask 1611.71000 · last trade 1611.35000`) && / UTC</.test(after), "its source, host and time");
    assert.ok(!/>Kraken XZECZUSD/.test(after), "a test double is never presented as Kraken");
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
    await post(await page(), 'name="lockSeq"'); // approve at this lock (slice I3)
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

test("pay follows the rate guard on the page, posted without JavaScript: no Pay before a lock; after a wallet refusal the rate can be re-locked; a moved market is explained and pays nothing; re-lock, then it pays (slice G2b2)", { skip: !RUN }, async () => {
  let bid = "1600.00";
  const source = http.createServer((_req, res) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: [(Number(bid) + 1).toFixed(2), "1", "1"], b: [bid, "1", "1"], c: [bid, "0.1"] } } })));
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  const s = await start(demoEnv("guard", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(), ZECEIPT_RATE_URL: `http://127.0.0.1:${(source.address() as { port: number }).port}/t` }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const draft = JSON.stringify({ title: "guard", items: [{ payableId: "g1", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "3000", memo: "GUARD-1" }] });
    const id = (JSON.parse((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, draft)).body) as { id: string }).id;
    const page = async () => (await raw(s.port, "GET", `/batches/${id}`, { host: self })).body.replaceAll("<!-- -->", "");
    const post = async (html: string, marker: string) => {
      const f = multipart(formFields(html, marker));
      return (await raw(s.port, "POST", `/batches/${id}`, { ...same, "content-type": f.type }, f.body)).body.replaceAll("<!-- -->", "");
    };

    const unlocked = await page();
    assert.ok(!unlocked.includes('name="confirmTotalZat"') && unlocked.includes("Lock the ZEC/USD rate below before approving."), "no Approve or Pay before a lock; the page says what to do");

    await post(unlocked, ">Lock rate</button>");
    const toApprove = await page();
    assert.ok(toApprove.includes("Approve paying 0.00003000 ZEC at 1 ZEC = $1,600.00") && !toApprove.includes("Pay 0.00003000 ZEC"), "Approve appears once locked (slice I3)");
    await post(toApprove, 'name="lockSeq"');
    const locked = await page();
    assert.ok(locked.includes("Pay 0.00003000 ZEC"), "Pay appears once approved");

    // The wallet refuses the first attempt (nothing paid): the batch can still be re-locked (review G2b1).
    fake.nextPay = "refused";
    const walletRefused = await post(locked, 'name="confirmTotalZat"');
    assert.ok(walletRefused.includes("Not done:") && walletRefused.includes("This request sent nothing."));
    const afterRefusal = await page();
    assert.ok(afterRefusal.includes(">Re-lock rate</button>") && !afterRefusal.includes("its rate can no longer be changed"), "a refused batch keeps its Re-lock form");

    bid = "1680.00"; // +5.00%
    const refused = await post(afterRefusal, 'name="confirmTotalZat"');
    assert.ok(refused.includes("Rate moved:") && refused.includes("ZEC/USD moved 5.00% since the lock (1600.00 → 1680.00 USD per ZEC); at most 3.00% is allowed. Re-lock the rate, approve the batch again, then pay. This request sent nothing."), "the refusal in plain words with both rates");
    assert.equal(fake.payCalls, 1, "only the refused attempt reached the wallet; the moved retry paid nothing");

    await post(await page(), ">Re-lock rate</button>");
    const relocked = await page();
    // The re-lock voided the approval: the page offers Approve at the new rate, not Pay (slice I3).
    assert.ok(relocked.includes("Approve paying 0.00003000 ZEC at 1 ZEC = $1,680.00") && !relocked.includes("Pay 0.00003000 ZEC"), "approve again after a re-lock");
    await post(relocked, 'name="lockSeq"');
    const paid = await post(await page(), 'name="confirmTotalZat"');
    assert.equal(fake.payCalls, 2, "paid once after the re-lock (the refused call counted, paid nothing)");
    assert.ok(paid.includes("Broadcast, not in a block yet"), "the page shows the new status");
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    await fake.stop();
    await new Promise((r) => source.close(r));
  }
});

test("recipients page through next start, posted as a browser without JavaScript: add (303), a duplicate flagged on both rows, an invalid address shown under its field with values kept (slice H2)", { skip: !RUN }, async () => {
  const s = await start(demoEnv("recipients", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined, ZECEIPT_AUTO_RECEIPTS_SECONDS: "60" }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    assert.ok(!s.output().includes("receipts: automatic issuance"), "external custody runs no receipt worker (slice I2)");
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const page = async () => (await raw(s.port, "GET", "/recipients", { host: self })).body.replaceAll("<!-- -->", "");
    const add = async (html: string, fields: Record<string, string>, headers: Record<string, string> = same) => {
      const hidden = formFields(html, "Add recipient");
      const m = multipart([...hidden, ...Object.entries(fields)]);
      return raw(s.port, "POST", "/recipients", { ...headers, "content-type": m.type }, m.body);
    };
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const MAINNET = "u1792v3nrp9qn6pe74qa06eapjjlh60sdgd47cg46atejesujes03qj04qmm3zs62a2qjfaju7kx7e83mml47rlenm66mqm2z0v5j5mtel";

    const home = (await raw(s.port, "GET", "/", { host: self })).body;
    assert.ok(home.includes('href="/recipients"'), "the header links to the recipients page");
    const empty = await page();
    assert.ok(empty.includes("No recipients yet.") && empty.includes('placeholder="uregtest1…"'), "empty state; the address hint follows the network");

    const first = await add(empty, { displayName: "Ops wallet", address: UA, kycStatus: "verified", taxFlag: "non_us", settlementPref: "zec", notes: "" });
    assert.equal(first.status, 303, first.body.slice(0, 200));
    assert.equal(first.location, "/recipients");
    const second = await add(await page(), { displayName: "Grants wallet", address: UA.toUpperCase(), kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "" });
    assert.equal(second.status, 303, "a duplicate address is created, not refused");
    const listed = await page();
    assert.ok(listed.includes("Pays the same Orchard receiver as Grants wallet") && listed.includes("Pays the same Orchard receiver as Ops wallet"), "flagged on both rows");
    assert.ok(listed.includes("Verified") && listed.includes("Non-US"), "KYC and tax shown");
    // ZIP 316 (review H2): abridged to a prefix of the separator plus 25 data characters; the whole address in <details>.
    assert.ok(listed.includes(`<code>${UA.slice(0, "uregtest1".length + 25)}…</code>`), "the ZIP 316 prefix");
    assert.ok(/<details[^>]*><summary[^>]*><code>uregtest1[^<]*…<\/code><\/summary><code[^>]*>uregtest1qzj498rks3e6gfazv0fx[a-z0-9]*<\/code><\/details>/.test(listed), "the whole address one click away");

    const bad = await add(listed, { displayName: "Wrong network", address: MAINNET, kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "keep me" });
    assert.equal(bad.status, 200);
    const shown = bad.body.replaceAll("<!-- -->", "");
    assert.ok(shown.includes("expected a regtest unified address"), "the address error is shown");
    assert.ok(/name="address"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*name="address"/.test(shown), "on the address field");
    assert.ok(shown.includes('value="Wrong network"') && shown.includes('value="keep me"'), "the entered values stay");
    assert.ok(!(await page()).includes(">Wrong network<"), "nothing saved");

    const cross = await add(listed, { displayName: "Evil", address: UA, kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "" }, { host: self, origin: "http://evil.example" });
    assert.equal(cross.status, 403);
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("zecpay import through next start, as a browser without JavaScript: Preview writes nothing and shows each address, Import writes what it showed, a changed file or kind is previewed again (slice I3b)", { skip: !RUN }, async () => {
  const s = await start(demoEnv("zecpay-import", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const text = (b: string) => b.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const UA2 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
    const csv = `name,wallet,amount,currency,payout_currency\nAlice,${UA},500,USD,ZEC\nBob,${UA2},227.50,,\nEve,zs1abc,200,ZEC,ZEC`;
    const payables = async () => (JSON.parse((await raw(s.port, "GET", "/api/payables", { host: self })).body) as { payables: { reference: string; usdCents: number }[] }).payables;
    const post = (html: string, fields: [string, string][], headers: Record<string, string> = same) => {
      const m = multipart([...formFields(html, 'name="csv"'), ...fields]);
      return raw(s.port, "POST", "/payables", { ...headers, "content-type": m.type }, m.body);
    };
    const first = (await raw(s.port, "GET", "/payables", { host: self })).body;
    assert.ok(text(first).includes("Import payables from a zecpay CSV"), "the page offers the import");

    const previewed = await post(first, [["csv", csv], ["kind", "bounty"], ["prefix", "SEP"], ["intent", "preview"]]);
    assert.equal(previewed.status, 200);
    const shown = text(previewed.body);
    assert.ok(shown.includes("Preview: 2 payables to add") && shown.includes(">Import 2 payables<"), "two rows to add, and the button says so");
    assert.ok(shown.includes("SEP-2") && shown.includes("SEP-3") && shown.includes("Alice (new)") && shown.includes("$227.50"), "references, new recipients and amounts");
    assert.ok(shown.includes("CSV line 4 will not be imported: the amount is in ZEC"), "Eve's refusal, by CSV line");
    assert.ok(shown.includes("<th>Address it will pay</th>") && shown.includes(`title="${UA}"`) && shown.includes(UA2), "each row shows the address it will pay, abridged, the full address a click away");
    assert.deepEqual(await payables(), [], "the preview wrote nothing");

    // Import from another site: refused before anything runs.
    assert.equal((await post(previewed.body, [["csv", csv], ["kind", "bounty"], ["prefix", "SEP"], ["intent", "confirm"]], { host: self, origin: "http://evil.example" })).status, 403);
    // Import with a changed file: the fingerprint does not match, so it previews again and writes nothing.
    const changed = await post(previewed.body, [["csv", csv.replace("500", "501")], ["kind", "bounty"], ["prefix", "SEP"], ["intent", "confirm"]]);
    assert.equal(changed.status, 200);
    assert.ok(text(changed.body).includes("changed since the preview; nothing was imported; preview again"));
    assert.deepEqual(await payables(), []);
    // Import as another kind than previewed: the kind is part of the fingerprint, so it previews again too.
    const otherKind = await post(previewed.body, [["csv", csv], ["kind", "salary"], ["prefix", "SEP"], ["intent", "confirm"]]);
    assert.ok(text(otherKind.body).includes("changed since the preview; nothing was imported; preview again"));
    assert.deepEqual(await payables(), []);

    // The outcome is in the action's answer, and the page it renders lists the new payables; no link carries it.
    const imported = await post(previewed.body, [["csv", csv], ["kind", "bounty"], ["prefix", "SEP"], ["intent", "confirm"]]);
    assert.equal(imported.status, 200);
    const done = text(imported.body);
    const noticeAt = done.indexOf("Imported 2 payables and 2 new recipients from the zecpay CSV.");
    const formAt = done.lastIndexOf("<details", done.indexOf("Import payables from a zecpay CSV"));
    assert.ok(noticeAt !== -1 && noticeAt < formAt, "the notice, before the import's <details> (closed after an import), so it is visible");
    assert.ok(!/<details[^>]*\sopen/.test(done.slice(formAt, done.indexOf("</summary>", formAt))), "the import's <details> is closed");
    assert.ok(done.includes("SEP-2") && !done.includes("Preview: 2 payables to add"), "the list shows the new payables; the preview is gone");
    assert.ok(!text((await raw(s.port, "GET", "/payables?imported=9&newRecipients=9", { host: self })).body).includes("Imported"), "a crafted link shows no notice");
    assert.deepEqual((await payables()).map((p) => [p.reference, p.usdCents]).sort(), [["SEP-2", 50000], ["SEP-3", 22750]]);
    assertNoKey(s.output());
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("payables page through next start, posted as a browser without JavaScript: add in dollars (303), the kind filter, and every error under its field with values kept (slice H4)", { skip: !RUN }, async () => {
  const s = await start(demoEnv("payables", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const page = async (q = "") => (await raw(s.port, "GET", `/payables${q}`, { host: self })).body.replaceAll("<!-- -->", "");
    const add = async (html: string, fields: Record<string, string>, headers: Record<string, string> = same) => {
      const hidden = formFields(html, "Add payable");
      const m = multipart([...hidden, ...Object.entries(fields)]);
      return raw(s.port, "POST", "/payables", { ...headers, "content-type": m.type }, m.body);
    };
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const UA2 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";

    assert.ok((await raw(s.port, "GET", "/", { host: self })).body.includes('href="/payables"'), "the header links to the payables page");
    const none = await page();
    assert.ok(none.includes("No payables yet.") && none.includes("Add a recipient first") && !none.includes("Add payable"), "no recipients: the prompt, not the form");

    const created = await raw(s.port, "POST", "/api/recipients", { ...same, "content-type": "application/json" }, JSON.stringify({ displayName: "Ops wallet", address: UA }));
    assert.equal(created.status, 201);
    const recipientId = (JSON.parse(created.body) as { id: string }).id;
    const empty = await page();
    assert.ok(empty.includes(`>Ops wallet · ${UA.slice(0, 34)}…</option>`) && empty.includes('inputMode="decimal"'), "the form: recipients by name and address prefix; the money input");
    assert.ok(/<select name="recipientId"[^>]*><option value="" selected="">Choose a recipient<\/option>/.test(empty), "nothing pre-selected: the first option, selected, is 'Choose a recipient' (review H4, GOV.UK Select)");
    const twin = await raw(s.port, "POST", "/api/recipients", { ...same, "content-type": "application/json" }, JSON.stringify({ displayName: "Ops wallet", address: UA2 }));
    assert.equal(twin.status, 201);
    const twins = await page();
    assert.ok(twins.includes(`>Ops wallet · ${UA2.slice(0, 34)}…</option>`) && twins.includes(`>Ops wallet · ${UA.slice(0, 34)}…</option>`), "two recipients with one name: two different option labels");

    const first = await add(empty, { recipientId, kind: "bounty", amount: "$1,234.56", reference: " BOUNTY-17 ", sourceUrl: "https://github.com/org/repo/issues/17" });
    assert.equal(first.status, 303, first.body.slice(0, 300));
    assert.equal(first.location, "/payables");
    const second = await add(await page(), { recipientId, kind: "salary", amount: "2500", reference: "SALARY-SEP", sourceUrl: "" });
    assert.equal(second.status, 303);
    const listed = await page();
    assert.ok(listed.includes("<code>BOUNTY-17</code>") && listed.includes("$1,234.56") && listed.includes("$2,500.00"), "exact dollars; the reference trimmed by the form");
    assert.ok(listed.includes(`${UA.slice(0, 34)}…</div>`), "the list's recipient cell carries the address prefix, so the two 'Ops wallet's can be told apart");
    assert.ok(/href="https:\/\/github.com\/org\/repo\/issues\/17" rel="noopener noreferrer"[^>]*>github.com</.test(listed), "the source link, its host as the text");
    const bounties = await page("?kind=bounty");
    assert.ok(bounties.includes("BOUNTY-17") && !bounties.includes("SALARY-SEP") && bounties.includes('aria-current="page"'), "the kind filter");
    assert.ok((await page("?kind=milestone")).includes("No milestone payables."));
    assert.ok((await page("?kind=nonsense")).includes("SALARY-SEP"), "an unknown kind shows all");

    const count = async () => ((await (await fetch(`http://${self}/api/payables`)).json()) as { payables: unknown[] }).payables.length;
    const before = await count();
    const shown = (r: { body: string }) => r.body.replaceAll("<!-- -->", "");
    const field = (html: string, name: string) => new RegExp(`name="${name}"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*name="${name}"`).test(html);

    const cents = shown(await add(listed, { recipientId, kind: "invoice", amount: "12.345", reference: "INV-KEEP", sourceUrl: "" }));
    assert.ok(cents.includes("at most 2 decimal places") && field(cents, "amount") && cents.includes('value="12.345"') && cents.includes('value="INV-KEEP"'), "the amount error under the amount; values kept");
    const taken = shown(await add(listed, { recipientId, kind: "invoice", amount: "5", reference: "BOUNTY-17", sourceUrl: "" }));
    assert.ok(taken.includes("Already used by another payable") && field(taken, "reference"), "a taken reference under the reference");
    const script = shown(await add(listed, { recipientId, kind: "invoice", amount: "5", reference: "INV-JS", sourceUrl: "javascript:alert(1)" }));
    assert.ok(script.includes("source link must be an absolute https://") && field(script, "sourceUrl"), "a script link under the source");
    const nobody = shown(await add(listed, { recipientId: "", kind: "invoice", amount: "5", reference: "INV-NOBODY", sourceUrl: "" }));
    assert.ok(nobody.includes("Choose who this payable is owed to.") && field(nobody, "recipientId") && nobody.includes('value="INV-NOBODY"'), "no recipient chosen: under the recipient, values kept");
    const zero = shown(await add(listed, { recipientId, kind: "invoice", amount: "0", reference: "INV-ZERO", sourceUrl: "" }));
    assert.ok(zero.includes("whole US cents from 1") && field(zero, "amount"), "the API's usd_invalid shown on the amount");
    assert.equal(await count(), before, "nothing saved");

    assert.equal((await add(listed, { recipientId, kind: "invoice", amount: "5", reference: "EVIL", sourceUrl: "" }, { host: self, origin: "http://evil.example" })).status, 403);
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("a batch made from payables through next start: USD at lock equals each payable's dollars; the lock is shown and fixed, with no Lock/Re-lock form (slice H5a)", { skip: !RUN }, async () => {
  const s = await start(demoEnv("from-payables", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const h = { host: self, origin: `http://${self}`, "content-type": "application/json" };
    const post = async (path: string, body: unknown) => {
      const r = await raw(s.port, "POST", path, h, JSON.stringify(body));
      assert.equal(r.status, 201, `${path}: ${r.body}`);
      return JSON.parse(r.body) as { id: string; items: { zat: string; usdCents: number }[]; rateLock: { rate: string }; rateFixed: boolean };
    };
    const alice = await post("/api/recipients", { displayName: "Alice", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w" });
    const cents = [123_456, 29, 99_999_999];
    const ids = [];
    for (const [i, c] of cents.entries()) ids.push((await post("/api/payables", { recipientId: alice.id, kind: "invoice", usdCents: c, reference: `FP-${i}` })).id);
    const batch = await post("/api/batches/from-payables", { title: "From payables", payableIds: ids });
    assert.deepEqual([batch.rateLock.rate, batch.rateFixed], ["1600.00", true]);
    // At 1600.00 USD/ZEC: $1,234.56 is 0.77160000 ZEC, $0.29 is 0.00018125 ZEC, $999,999.99 is 624.99999375 ZEC.
    assert.deepEqual(batch.items.map((i) => i.zat), ["77160000", "18125", "62499999375"]);
    const page = (await raw(s.port, "GET", `/batches/${batch.id}`, { host: self })).body.replaceAll("<!-- -->", "");
    for (const usd of ["$1,234.56", "$0.29", "$999,999.99"]) assert.ok(page.includes(usd), `USD at lock shows ${usd}`);
    assert.ok(page.includes("1 ZEC = $1,600.00") && page.includes("Made from payables: each line was converted from its US dollars at this rate, so the rate is fixed."), "the lock, and why it is fixed");
    assert.ok(!page.includes("Re-lock rate") && !page.includes(">Lock rate<"), "no Lock/Re-lock form");
    const relock = await raw(s.port, "POST", `/api/batches/${batch.id}/rate-lock`, { host: self, origin: `http://${self}` });
    assert.equal(relock.status, 409);
    assert.equal((JSON.parse(relock.body) as { code: string }).code, "rate_fixed");
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("choosing payables through next start, as a browser without JavaScript: 303 to the new batch; statuses; nothing chosen, a source failure and a cross-site post refused with values kept (slice H5b)", { skip: !RUN }, async () => {
  // A ticker this test controls, so the source can fail on demand.
  let tickerUp = true;
  const ticker = http.createServer((_req, res) => {
    if (!tickerUp) return void res.writeHead(503).end("down");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: [], result: { XZECZUSD: { a: ["1601.00", "1", "1"], b: ["1600.00", "1", "1"], c: ["1600.00", "0.1"] } } }));
  });
  await new Promise<void>((r) => ticker.listen(0, "127.0.0.1", r));
  const s = await start(demoEnv("choose-payables", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined, ZECEIPT_RATE_URL: `http://127.0.0.1:${(ticker.address() as { port: number }).port}/0/public/Ticker?pair=ZECUSD` }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const get = async (path: string) => (await raw(s.port, "GET", path, { host: self })).body.replaceAll("<!-- -->", "");
    const choose = async (html: string, title: string, ids: string[], headers: Record<string, string> = same) => {
      const m = multipart([...formFields(html, "Make batch at today"), ["title", title], ...ids.map((id) => ["payableIds", id] as [string, string])]);
      return raw(s.port, "POST", "/batches/from-payables", { ...headers, "content-type": m.type }, m.body);
    };
    const post = async (path: string, body: unknown) => JSON.parse((await raw(s.port, "POST", path, { ...same, "content-type": "application/json" }, JSON.stringify(body))).body) as { id: string };

    assert.ok((await get("/")).includes('href="/batches/from-payables"') && (await get("/payables")).includes('href="/batches/from-payables"'), "linked from the batch list and the payables page");
    assert.ok((await get("/batches/from-payables")).includes("No payables to pay."), "the empty state");
    const alice = await post("/api/recipients", { displayName: "Alice", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w" });
    const ids = [];
    for (const [ref, cents] of [["CH-1", 123_456], ["CH-2", 29], ["CH-3", 5_000]] as const) ids.push((await post("/api/payables", { recipientId: alice.id, kind: "invoice", usdCents: cents, reference: ref })).id);
    const page = await get("/batches/from-payables");
    for (const id of ids) assert.ok(page.includes(`value="${id}"`), "every free payable offered");
    assert.ok(!/<input[^>]*type="checkbox"[^>]*checked/.test(page), "nothing pre-selected (GOV.UK checkboxes)");
    assert.ok(page.includes("<legend") && page.includes("Payables to pay") && page.includes("Select up to 50."), "a fieldset with a legend and hint");

    const none = await choose(page, "Nothing", []);
    assert.equal(none.status, 200);
    assert.ok(none.body.includes("Choose at least one payable.") && none.body.includes('value="Nothing"'), "nothing chosen: the error, the title kept");

    tickerUp = false;
    const down = (await choose(page, "Down", [ids[0]])).body.replaceAll("<!-- -->", "");
    assert.ok(down.includes("did not give a usable quote, so nothing was made") && /value="[^"]*"[^>]*checked=""|checked=""[^>]*value="/.test(down), "the source down: said at the top, the choice kept");
    tickerUp = true;
    assert.equal((await get("/payables")).match(/>Unbatched</g)?.length, 3, "nothing was made");

    const made = await choose(page, "Chosen two", [ids[0], ids[1]]);
    assert.equal(made.status, 303, made.body.slice(0, 300));
    assert.match(String(made.location), /^\/batches\/[0-9a-f-]{36}$/);
    const batchPage = await get(String(made.location));
    assert.ok(batchPage.includes("Chosen two") && batchPage.includes("$1,234.56") && batchPage.includes("$0.29") && !batchPage.includes("CH-3"), "the batch holds the two chosen lines");
    const payables = await get("/payables");
    assert.equal(payables.match(/In batch Chosen two/g)?.length, 2, "both chosen payables show their batch");
    assert.equal(payables.match(/>Unbatched</g)?.length, 1);
    const left = await get("/batches/from-payables");
    assert.ok(left.includes(`value="${ids[2]}"`) && !left.includes(`value="${ids[0]}"`), "the chooser offers only the free one");
    // Review H5b: a page loaded before another batch took a payable. The refusal must be visible, naming the payable.
    const stale = (await choose(page, "Stale", [ids[0], ids[2]])).body.replaceAll("<!-- -->", "");
    assert.ok(/role="alert"[^>]*>[\s\S]*CH-1 is already in the batch &quot;Chosen two&quot;, so it is no longer offered\./.test(stale), "the stale choice is explained at the top, naming the batch by title");
    assert.equal((await get("/payables")).match(/>Unbatched</g)?.length, 1, "nothing was made");
    assert.equal((await choose(left, "Evil", [ids[2]], { host: self, origin: "http://evil.example" })).status, 403);
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    await new Promise((r) => ticker.close(r));
  }
});

test("voiding a draft from the batch page through next start, as a browser without JavaScript: a link, a confirmation with a warning button, 303; paid batches offer nothing; a stale confirmation is refused in words (slice H5d)", { skip: !RUN }, async () => {
  const s = await start(demoEnv("void-page", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}` };
    const get = async (path: string) => (await raw(s.port, "GET", path, { host: self })).body.replaceAll("<!-- -->", "");
    const hand = async (memo: string) => JSON.parse((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, JSON.stringify({ title: `Draft ${memo}`, items: [{ payableId: `p-${memo}`, address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "150000000", memo }] }))).body) as { id: string };
    const confirm = async (html: string, path: string, headers: Record<string, string> = same) => {
      const m = multipart(formFields(html, "Void this batch"));
      return raw(s.port, "POST", path, { ...headers, "content-type": m.type }, m.body);
    };

    const b = await hand("VOID-PAGE-1");
    const page = await get(`/batches/${b.id}`);
    assert.ok(page.includes(`href="/batches/${b.id}/void"`) && page.includes("Void this draft…"), "the batch page links to the confirmation (a link, not a button)");
    const confirmPage = await get(`/batches/${b.id}/void`);
    // The amount is one visible string over spans (the trailing zeros lighter, as everywhere else; review F round 1).
    assert.ok(confirmPage.includes("Void batch Draft VOID-PAGE-1?") && confirmPage.includes("Voiding is final: it can never be paid, and it cannot be undone.") && confirmPage.replace(/<[^>]+>/g, "").includes("1.50000000 ZEC"), "the consequences, in words, and which batch");
    assert.ok(/<button[^>]*btn-danger[^>]*>Void this batch<\/button>/.test(confirmPage) && confirmPage.includes(`href="/batches/${b.id}">Cancel`), "a warning button that names the action, and Cancel");

    assert.equal((await confirm(confirmPage, `/batches/${b.id}/void`, { host: self, origin: "http://evil.example" })).status, 403, "cross-site");
    const done = await confirm(confirmPage, `/batches/${b.id}/void`);
    assert.equal(done.status, 303, done.body.slice(0, 300));
    assert.equal(done.location, `/batches/${b.id}`);
    const voided = await get(`/batches/${b.id}`);
    assert.ok(voided.includes("Voided") && !voided.includes("Void this draft…") && !voided.includes("Lock rate") && !voided.includes(">Pay ") && !voided.includes("Approve paying"), "read-only: no Lock, Approve, Pay or Void control");
    assert.ok((await get(`/batches/${b.id}/void`)).includes("This batch was voided on") && !(await get(`/batches/${b.id}/void`)).includes("Void this batch</button>"), "its confirmation page offers nothing");
    assert.equal((await raw(s.port, "POST", "/api/batches", { ...same, "content-type": "application/json" }, JSON.stringify({ title: "again", items: [{ payableId: "p-again", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1", memo: "VOID-PAGE-1" }] }))).status, 201, "its memo is free again");

    // A batch an attempt may have sent, recorded as the execution library records a broadcast: nothing is offered.
    const recordBroadcast = async (id: string, txid: string) => {
      const side = openDb({ path: join(dir, "void-page.db") });
      try {
        const rec = (await getBatch(side, "demo-org", id))!;
        const store = new SqliteIdempotencyStore(side, { orgId: "demo-org" });
        const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: new Date().toISOString(), attempts: 1 };
        await store.createIntent({ ...base, state: "submitting" });
        await store.update({ ...base, state: "broadcast", txid }, { attempts: 1, states: ["submitting"] });
      } finally {
        side.$client.close();
      }
    };
    const paid = await hand("VOID-PAGE-PAID");
    await recordBroadcast(paid.id, "cd".repeat(32));
    assert.ok(!(await get(`/batches/${paid.id}`)).includes("Void this draft…"), "a sent batch's page has no void link");
    const paidConfirm = await get(`/batches/${paid.id}/void`);
    assert.ok(paidConfirm.includes("A payment attempt may have sent this batch, so it cannot be voided.") && !paidConfirm.includes("Void this batch</button>"), "and its confirmation page no button");

    // Review H5d: a stale confirmation page for a batch PAID in between (AC1): refused in words; nothing voided.
    const d = await hand("VOID-PAGE-3");
    const beforePay = await get(`/batches/${d.id}/void`);
    await recordBroadcast(d.id, "ef".repeat(32));
    const refused = (await confirm(beforePay, `/batches/${d.id}/void`)).body.replaceAll("<!-- -->", "");
    assert.ok(/role="alert"[^>]*>[\s\S]*Not voided:[\s\S]*may have sent this batch/.test(refused), "the refusal, in words");
    const dJson = JSON.parse((await raw(s.port, "GET", `/api/batches/${d.id}`, { host: self })).body) as { voided: unknown };
    assert.equal(dJson.voided, null, "nothing was voided");

    // A stale confirmation page: the batch is voided through the API in between; the page's post is refused in words.
    const c = await hand("VOID-PAGE-2");
    const stalePage = await get(`/batches/${c.id}/void`);
    assert.equal((await raw(s.port, "POST", `/api/batches/${c.id}/void`, same)).status, 200);
    const stale = (await confirm(stalePage, `/batches/${c.id}/void`)).body.replaceAll("<!-- -->", "");
    assert.ok(/role="alert"[^>]*>[\s\S]*Not voided:[\s\S]*already voided/.test(stale), "the refusal, in words");
    assert.equal((await get("/batches/01900000-0000-7000-8000-000000000000/void")).includes("404") || (await raw(s.port, "GET", "/batches/01900000-0000-7000-8000-000000000000/void", { host: self })).status === 404, true, "404 for an unknown batch");
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

test("the linkability warning through next start (REQ-CON-6, slice H6): after real receipts for batch A, a new draft paying the same recipient shows the report, and the recipients page and chooser flag it", { skip: !RUN }, async () => {
  const s = await start(demoEnv("linkability", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  const ROOT = resolve(APP, "../..");
  const BIN = process.env.ZECEIPT_BIN ?? join(ROOT, "target/debug/zeceipt"); // as every other test (review H6)
  const TXID = "48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2";
  const FIXTURE = [
    { payableId: "p-2", label: "R2", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "101000000", memo: "INV-R-002" },
    { payableId: "p-3", label: "R3", address: "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj", zat: "102000000", memo: "INV-R-003" },
    { payableId: "p-4", label: "R4", address: "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5", zat: "103000000", memo: "INV-R-004" },
  ];
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const same = { host: self, origin: `http://${self}`, "content-type": "application/json" };
    const post = async (path: string, body: unknown) => JSON.parse((await raw(s.port, "POST", path, same, JSON.stringify(body))).body) as { id: string };
    const get = async (path: string) => (await raw(s.port, "GET", path, { host: self })).body.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
    const bob = await post("/api/recipients", { displayName: "Bob", address: FIXTURE[1].address });
    const fresh = await post("/api/recipients", { displayName: "Fresh", address: ua("uregtest", [item(3, 43, 9)]) });
    assert.match(fresh.id, /^[0-9a-f-]{36}$/, "a valid address no receipt disclosed");
    const quiet = await post("/api/batches", { title: "Quiet", items: [{ payableId: "q-1", address: FIXTURE[0].address, zat: "5", memo: "QUIET-1" }] });
    assert.ok(!(await get(`/batches/${quiet.id}`)).includes("Before paying: addresses already disclosed"), "no receipt yet: no panel");
    // Batch A: the fixture transaction's outputs, broadcast and receipted for real (the real CLI, the server's key).
    const a = await post("/api/batches", { title: "September", items: FIXTURE });
    const side = openDb({ path: join(dir, "linkability.db") });
    try {
      const rec = (await getBatch(side, "demo-org", a.id))!;
      const store = new SqliteIdempotencyStore(side, { orgId: "demo-org" });
      const base = { nonce: batchNonce(rec), batchId: rec.id, batchDigest: batchDigest(toExecutionBatch(rec)), createdAt: new Date().toISOString(), attempts: 1 };
      await store.createIntent({ ...base, state: "submitting" });
      await store.update({ ...base, state: "broadcast", txid: TXID }, { attempts: 1, states: ["submitting"] });
      const keyFile = join(dir, "linkability-issuer.key");
      execFileSync(BIN, ["keygen", "--out", keyFile]);
      const out = await autoIssue({ batch: toExecutionBatch(rec), txid: TXID, status: { state: "mined", height: 626, confirmations: 3, tip: 628 }, requiredConfirmations: 1, cli: { bin: BIN, rawTxFile: join(ROOT, `fixtures/regtest-${TXID}.hex`), ufvkFile: join(ROOT, "fixtures/regtest-issuer-ufvk.txt"), keyFile, host: "https://receipts.example", keyId: "2026-09", challenge: "h6e2e" } });
      await recordReceipts(side, new Keyring([{ kid: "k1", key: KEY }]), { orgId: "demo-org", batchId: rec.id, issued: out as Extract<AutoIssueResult, { state: "issued" }> });
    } finally {
      side.$client.close();
    }
    const quietNow = await get(`/batches/${quiet.id}`);
    assert.ok(quietNow.includes("Before paying: addresses already disclosed") && quietNow.includes('Line 1 (QUIET-1): A receipt already disclosed this address (batch "September").'), "the batch validation report names the line and the batch");
    assert.ok(quietNow.includes(LINKABILITY_SPEC) && quietNow.includes("fresh address from the same wallet"), "spec §9's words and the remedy");
    assert.ok(!(await get(`/batches/${a.id}`)).includes("Before paying: addresses already disclosed"), "A is not warned about its own receipts");
    // Slice X2c: the page offers the OpenZcash export with what it discloses, and the served app delivers the file
    // to the console's own page and refuses another site (X2b's rule, through next start).
    const aPage = await get(`/batches/${a.id}`);
    assert.ok(aPage.includes(`href="/api/batches/${a.id}/exports/openzcash"`) && aPage.includes(">Download for OpenZcash (CSV)<"), "the page offers the export");
    assert.ok(aPage.includes("All 3 lines, in OpenZcash's own export columns, plus the txid, receipt link and rate."), "a complete batch says so");
    assert.ok(aPage.includes('aria-describedby="export-scope export-disclosure"'), "the link is described by what the file holds and discloses");
    assert.ok(aPage.includes("The file holds every receipt link above. Whoever gets it can see each of these payments, and that cannot be taken back"), "the disclosure, before the download");
    const file = await raw(s.port, "GET", `/api/batches/${a.id}/exports/openzcash`, { host: self, "sec-fetch-site": "same-origin" });
    assert.deepEqual([file.status, file.type, file.headers["content-disposition"], file.headers["cache-control"]], [200, "text/csv; charset=utf-8", `attachment; filename="zeceipt-openzcash-${a.id}.csv"`, "no-store"]);
    assert.ok(file.body.startsWith('\uFEFF"Recipient","Detail","Category","USD","ZEC","Date","Status","Txid","Receipt","Rate"\r\n'), "OpenZcash's header, after a BOM");
    assert.equal(file.body.split("\r\n").length, 4, "three rows");
    assert.equal((await raw(s.port, "GET", `/api/batches/${a.id}/exports/openzcash`, { host: self, "sec-fetch-site": "cross-site" })).status, 403, "not for another site");
    assert.ok(!s.output().includes("receipts.example/r#") && !s.output().includes("/r#ey"), "no receipt link in the server output");
    assert.ok(!(await get(`/batches/${quiet.id}`)).includes("Download for OpenZcash"), "no receipts, no export link");
    const people = await get("/recipients");
    assert.ok(people.includes('A receipt already disclosed this address (batch "September").') && people.includes('id="linkability"'), "the recipients page flags Bob and explains");
    // Rendered text only (after ">"); the same words also sit in React's serialised payload inside a <script>.
    assert.equal(people.match(/>A receipt already disclosed this address/g)?.length, 1, "only Bob, not Fresh");
    await post("/api/payables", { recipientId: bob.id, kind: "invoice", usdCents: 1000, reference: "LINK-1" });
    const chooser = await get("/batches/from-payables");
    assert.ok(chooser.includes('A receipt already disclosed this address (batch "September").') && chooser.includes('id="linkability"'), "the chooser flags the payable");
  } finally {
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
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

    // Slice I2: "Fill from Konclave CSV" fills the lines for review (nothing created), then the draft is created from them.
    const csv = `label,address,value,memo\n\nAlice,${UA},.5,IMP-A\nBob,${UA},0.25,\nCarol,${UA},oops,x`;
    const fill = multipart([...hidden, ["title", ""], ...lineFields(0, {}), ["csv", csv], ["memoPrefix", "IMP"], ["intent", "import"]]);
    const filled = await raw(s.port, "POST", "/batches/new", { ...same, "content-type": fill.type }, fill.body);
    assert.equal(filled.status, 200);
    const shown = filled.body.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
    for (const note of ["Added 2 lines from the CSV; review them, then create the draft.", "CSV line 4: it had no memo, so it was given IMP-4.", "CSV line 5 was not added: invalid amount 'oops'."]) {
      assert.ok(shown.includes(note), note);
    }
    assert.ok(shown.includes('value="row-3"') && shown.includes('value="0.5"') && shown.includes('value="IMP-4"'), "the rows are in the form's lines");
    assert.equal(await count(), 1, "filling creates nothing");
    const make = multipart([...hidden, ["title", "Imported"], ...lineFields(0, { payableId: "row-3", label: "Alice", address: UA, amount: "0.5", memo: "IMP-A" }), ...lineFields(1, { payableId: "row-4", label: "Bob", address: UA, amount: "0.25", memo: "IMP-4" })]);
    const made = await raw(s.port, "POST", "/batches/new", { ...same, "content-type": make.type }, make.body);
    assert.equal(made.status, 303);
    const madeId = /^\/batches\/([0-9a-f-]{36})$/.exec(made.location ?? "")?.[1];
    const imported = JSON.parse((await raw(s.port, "GET", `/api/batches/${madeId}`, { host: self })).body) as { items: { payableId: string; zat: string; memo: string }[] };
    assert.deepEqual(imported.items.map((i) => [i.payableId, i.zat, i.memo]), [["row-3", "50000000", "IMP-A"], ["row-4", "25000000", "IMP-4"]]);
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

// Slice S1 (R95): plain `npm start` binds loopback. `next start` alone listens on 0.0.0.0, and the request guard stops
// browsers and DNS rebinding, not a network peer that writes its own `Host: localhost`; until sign-in exists the bind
// address is what keeps other machines out (RSK-24). Started exactly as an operator would, through the package script.
test("npm start binds 127.0.0.1 only: healthy on loopback, refused on this machine's own network address (slice S1)", { skip: !RUN }, async () => {
  const { networkInterfaces } = await import("node:os");
  const { spawn } = await import("node:child_process");
  const { freePort } = await import("./helpers/app-server.ts");
  const port = await freePort();
  let out = "";
  const child = spawn("npm", ["start", "--", "-p", String(port)], { cwd: APP, env: demoEnv("bind") as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  try {
    await waitHealthy(port, child, () => out);
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (lan) {
      const refused = await new Promise<string>((ok) => {
        const sock = connect({ host: lan, port }, () => {
          sock.destroy();
          ok("connected");
        });
        sock.on("error", (e) => ok((e as NodeJS.ErrnoException).code ?? "error"));
        sock.setTimeout(3000, () => {
          sock.destroy();
          ok("timeout");
        });
      });
      assert.equal(refused, "ECONNREFUSED", `a peer on ${lan}:${port} must not reach the console`);
    } else {
      // No non-loopback address on this machine: the listening socket itself must be the loopback one.
      const ls = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      assert.match(ls.stdout, /127\.0\.0\.1:\d+ \(LISTEN\)/);
      assert.doesNotMatch(ls.stdout, /\*:\d+ \(LISTEN\)/);
    }
  } finally {
    try {
      process.kill(-child.pid!, "SIGTERM"); // npm and the server it started: the whole process group, nothing else
    } catch {
      /* already gone */
    }
    await within(exited, 10_000, "npm start shutdown").catch(() => process.kill(-child.pid!, "SIGKILL"));
  }
});

// Slice S4 (R98): a framed console page posts same-origin, so the request guard cannot stop clickjacking; every
// response refuses to be framed (CSP frame-ancestors, and X-Frame-Options for older browsers), then Chrome proves it.
test("no response can be framed: security headers on pages, API, static files, 404s and refusals; a hostile origin's iframe of a batch page is blocked in Chrome (slice S4)", { skip: !BROWSER }, async () => {
  const { SECURITY_HEADERS } = await import("../next.config.ts");
  const fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  const s = await start(demoEnv("frames", { ZECEIPT_ZKOOL_URL: fake.url, ZECEIPT_ZKOOL_ACCOUNT: "9", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile() }));
  const hostile = http.createServer();
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const created = await raw(s.port, "POST", "/api/batches", { host: self, origin: `http://${self}`, "content-type": "application/json" }, JSON.stringify({ title: "Framed", items: [
      { payableId: "F-1", label: "Frank", address: "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w", zat: "1000000", memo: "FRAME-1" },
    ] }));
    assert.equal(created.status, 201, created.body);
    const id = (JSON.parse(created.body) as { id: string }).id;
    const home = await raw(s.port, "GET", "/", { host: self });
    const asset = /\/_next\/static\/[^"]+\.(?:js|css)/.exec(home.body)?.[0];
    assert.ok(asset, "a static asset linked from the home page");
    const responses: [string, Awaited<ReturnType<typeof raw>>][] = [
      ["page", home],
      ["batch page", await raw(s.port, "GET", `/batches/${id}`, { host: self })],
      ["health", await raw(s.port, "GET", "/api/health", { host: self })],
      ["API read", await raw(s.port, "GET", `/api/batches/${id}`, { host: self })],
      ["API refusal (cross-site write)", await raw(s.port, "POST", "/api/batches", { host: self, origin: "http://evil.example", "content-type": "application/json" }, "{}")],
      ["static file", await raw(s.port, "GET", asset!, { host: self })],
      ["404", await raw(s.port, "GET", "/no-such-page", { host: self })],
    ];
    for (const [name, r] of responses) {
      // Responses through proxy.ts (pages, static files, 404s) carry S4's policy plus a per-response script-src (S4b);
      // API responses carry S4's policy as next.config sends it.
      const viaProxy = !/^(health|API)/.test(name);
      for (const { key, value } of SECURITY_HEADERS) {
        const got = String(r.headers[key.toLowerCase()]);
        if (key === "Content-Security-Policy" && viaProxy) {
          assert.ok(got.startsWith(`${value}; default-src 'self'; script-src 'self' 'nonce-`) && got.endsWith("; connect-src 'self'"), `${name}: ${key} (status ${r.status}): ${got}`);
        } else assert.equal(got, value, `${name}: ${key} (status ${r.status})`);
      }
    }
    assert.deepEqual(responses.map(([, r]) => r.status), [200, 200, 200, 200, 403, 200, 404]);

    // A hostile page on another origin frames the batch page (where Approve and Pay live).
    hostile.on("request", (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>win a prize</title><iframe id="f" src="http://${self}/batches/${id}" width="800" height="600"></iframe>`));
    await new Promise<void>((r) => hostile.listen(0, "localhost", r));
    const page = await browser.newPage();
    const refusals: string[] = [];
    page.on("console", (m) => refusals.push(m.text()));
    await page.goto(`http://localhost:${(hostile.address() as { port: number }).port}/`, { waitUntil: "load" });
    await page.waitForTimeout(1_000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    assert.ok(frame, "the iframe exists");
    assert.ok(!frame!.url().startsWith(`http://${self}`) || (await frame!.content().catch(() => "")).indexOf("Framed") === -1, `the console did not render in the frame (${frame!.url()})`);
    assert.equal(await frame!.getByRole("button").count().catch(() => 0), 0, "no button to click in the frame");
    assert.ok(refusals.some((t) => /frame-ancestors|X-Frame-Options/i.test(t)), `Chrome names the refusal: ${JSON.stringify(refusals)}`);
    // The same page opened directly still works: the headers refuse framing only.
    await page.goto(`http://${self}/batches/${id}`);
    await page.getByRole("heading", { name: "Framed" }).waitFor({ timeout: 10_000 });
    assertNoKey(s.output());
  } finally {
    await browser.close();
    hostile.close();
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
    await fake.stop();
  }
});

// Slice S4b (R103): pages run only the scripts Next rendered for that response.
test("pages run only their own scripts: a fresh nonce per response on every script tag, the JavaScript draft form works with no violation, an injected script is blocked (slice S4b)", { skip: !BROWSER }, async () => {
  const s = await start(demoEnv("nonce", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const nonces: string[] = [];
    for (const path of ["/", "/", "/batches/new", "/no-such-page"]) {
      const r = await raw(s.port, "GET", path, { host: self });
      const csp = String(r.headers["content-security-policy"] ?? "");
      const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
      assert.ok(nonce, `${path}: a script policy with a nonce: ${csp}`);
      assert.match(csp, /frame-ancestors 'none'/, `${path}: S4's policy still applies`);
      assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/, `${path}: nothing unsafe under next start`);
      const tags = [...r.body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(tags.length > 0, `${path}: the page has scripts`);
      for (const t of tags) assert.ok(t.includes(`nonce="${nonce}"`), `${path}: every script tag carries this response's nonce: ${t.slice(0, 120)}`);
      nonces.push(nonce!);
    }
    assert.equal(new Set(nonces).size, nonces.length, "a fresh nonce for every response");

    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.goto(`http://${self}/batches/new`, { waitUntil: "networkidle" });
    // The client-side form works: removing a line is JavaScript.
    await page.getByLabel("Line 1 Payee").fill("Alice");
    await page.getByLabel("Line 2 Payee").fill("Bob");
    await page.getByRole("button", { name: "Remove line 1" }).click();
    assert.equal(await page.getByLabel("Line 1 Payee").inputValue(), "Bob", "hydrated: the form's JavaScript runs");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), [], "no violation from the console's own scripts");
    // Markup injected into the page (what an XSS would do) cannot run script: an inline handler has no nonce. The
    // handler runs in the page's own context; page.evaluate itself goes through DevTools, which CSP does not govern,
    // so a script created directly by evaluate would prove nothing.
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<img src="data:," onerror="window.__injected = true">'));
    await page.waitForFunction(() => (window as unknown as { __csp: string[] }).__csp.some((v) => v.startsWith("script-src")));
    assert.equal(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected === true), false, "an injected inline handler is blocked");
    assertNoKey(s.output());
  } finally {
    await browser.close();
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});

// Slice S4c: a page loads images, styles, fonts and connections only from the console itself.
test("pages load only from the console itself: every page renders and works with no violation; injected remote images and stylesheets are blocked (slice S4c)", { skip: !BROWSER }, async () => {
  const s = await start(demoEnv("tight", { ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_TOKEN_FILE: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined }));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await waitHealthy(s.port, s.child, s.output);
    const self = `127.0.0.1:${s.port}`;
    const json = { host: self, origin: `http://${self}`, "content-type": "application/json" };
    const UA = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    const created = await raw(s.port, "POST", "/api/batches", json, JSON.stringify({ title: "Tight", items: [{ payableId: "T-1", label: "Tess", address: UA, zat: "1000000", memo: "TIGHT-1" }] }));
    const id = (JSON.parse(created.body) as { id: string }).id;
    const page = await browser.newPage();
    // Playwright reports a request when Chrome starts it, before CSP refuses it; what matters is how it ends.
    const outsideAnswered: string[] = [];
    const outsideRefused: string[] = [];
    const isOutside = (u: string) => !u.startsWith(`http://${self}`) && !u.startsWith("data:");
    page.on("response", (r) => { if (isOutside(r.url())) outsideAnswered.push(r.url()); });
    page.on("requestfailed", (r) => { if (isOutside(r.url())) outsideRefused.push(`${r.url()} ${r.failure()?.errorText}`); });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    for (const path of ["/", "/recipients", "/payables", "/batches/new", "/batches/from-payables", `/batches/${id}`, `/batches/${id}/void`, "/no-such-page"]) {
      await page.goto(`http://${self}${path}`, { waitUntil: "networkidle" });
      assert.deepEqual(await violations(), [], `${path}: no violation`);
      // The canvas token (#f6f6f3, light scheme): only the console's own stylesheet sets it (unstyled, Chrome computes
      // rgba(0, 0, 0, 0)).
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(246, 246, 243)", `${path}: styled by the console's stylesheet`);
    }
    // JavaScript still works under the tight policy (the draft form), and a client-side navigation too.
    await page.goto(`http://${self}/batches/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Line 1 Payee").fill("Alice");
    await page.getByLabel("Line 2 Payee").fill("Bob");
    await page.getByRole("button", { name: "Remove line 1" }).click();
    assert.equal(await page.getByLabel("Line 1 Payee").inputValue(), "Bob");
    await page.getByRole("link", { name: "Recipients" }).click();
    await page.waitForURL(`http://${self}/recipients`);
    assert.deepEqual(await violations(), [], "no violation after using the form and navigating");
    // Injected markup cannot load anything from elsewhere.
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<img src="https://evil.example/leak.png"><link rel="stylesheet" href="https://evil.example/leak.css">'));
    await page.waitForFunction(() => (window as unknown as { __csp: string[] }).__csp.length >= 2);
    const v = await violations();
    assert.ok(v.some((x) => /^img-src https:\/\/evil\.example\/leak\.png/.test(x)), JSON.stringify(v));
    assert.ok(v.some((x) => /^style-src-elem https:\/\/evil\.example\/leak\.css/.test(x)), JSON.stringify(v));
    await page.waitForTimeout(300);
    assert.deepEqual(outsideAnswered, [], "nothing from outside the console was answered");
    assert.deepEqual(outsideRefused.sort(), ["https://evil.example/leak.css csp", "https://evil.example/leak.png csp"], "Chrome refused both for the policy (its failure text is \"csp\", measured)");
    assertNoKey(s.output());
  } finally {
    await browser.close();
    s.child.kill("SIGTERM");
    await within(s.exited, 10_000, "shutdown").catch(() => s.child.kill("SIGKILL"));
  }
});
