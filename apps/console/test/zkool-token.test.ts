// Slice S3: the console authenticates to Zkool with a token scoped to its own account (research log R97).
// zkool_graphql listens on every interface and, started with --jwt-public-key-file, refuses any request without
// an ES256 token {exp, sub, write}; the fake models its measured answers (FakeZkool.requireTokens).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ConfigError,
  checkZkoolToken,
  loadConfig,
  loadZkoolToken,
  MemoryIdempotencyStore,
  mintZkoolToken,
  PaymentRejectedError,
  PreflightFailedError,
  readZkoolToken,
  verifyZkoolToken,
  ZkoolAuthError,
  ZkoolBackend,
  ZkoolClient,
  ZkoolTokenError,
  ZkoolTransportError,
  type Batch,
} from "../lib/index.ts";
import { FakeZkool } from "./helpers/fake-zkool.ts";
import { foreignZkoolToken, ZKOOL_PRIVATE_PEM, ZKOOL_PUBLIC_PEM, zkoolToken, zkoolPublicKeyFile, zkoolTokenFile } from "./helpers/zkool-token.ts";

const run = promisify(execFile);
const NOW = new Date("2026-09-26T00:00:00Z");
const inDays = (d: number) => Math.floor(NOW.getTime() / 1000) + d * 86_400;
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ZkoolTokenError, String(e));
    return e.message;
  }
  assert.fail("should refuse");
};

let fake: FakeZkool;
let dir: string;
before(async () => {
  fake = (await new FakeZkool().start()).requireTokens(ZKOOL_PUBLIC_PEM);
  dir = mkdtempSync(join(tmpdir(), "zeceipt-s3-"));
});
after(async () => {
  await fake.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("mint and verify: ES256 (R‖S, 64 bytes), the claims asked for; Zkool's own check refuses another key, alg none, and an expired token", () => {
  const t = mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: 9, write: true });
  const [h, c, s] = t.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { exp: inDays(30), sub: 9, write: true });
  assert.equal(Buffer.from(s, "base64url").length, 64, "JWS ES256 signatures are R‖S (RFC 7518 §3.4), not DER");
  assert.deepEqual(verifyZkoolToken(t, ZKOOL_PUBLIC_PEM, NOW), { exp: inDays(30), sub: 9, write: true });
  const other = mintZkoolToken(freshKey().privateKey, { exp: inDays(30), sub: 9, write: true });
  assert.equal(verifyZkoolToken(other, ZKOOL_PUBLIC_PEM, NOW), undefined, "another key");
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${c}.${s}`;
  assert.equal(verifyZkoolToken(none, ZKOOL_PUBLIC_PEM, NOW), undefined, "alg none");
  const old = mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(0) - 61, sub: 9, write: true });
  assert.equal(verifyZkoolToken(old, ZKOOL_PUBLIC_PEM, NOW), undefined, "expired beyond jsonwebtoken's 60 s leeway");
  assert.throws(() => mintZkoolToken(freshKey("secp384r1").privateKey, { exp: 1, sub: 9, write: true }), /P-256/);
});

// A fresh key pair (another signer, or another curve).
function freshKey(curve = "prime256v1") {
  return generateKeyPairSync("ec", { namedCurve: curve, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
}

test("the console's scope check: only a write token for exactly its account, never admin, not expired; messages never echo the token", () => {
  const ok = mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: 9, write: true });
  assert.deepEqual(checkZkoolToken(ok, 9, NOW), { expiresAt: new Date(inDays(30) * 1000) });
  const cases: [string, string, RegExp][] = [
    ["not a JWT", "abc", /three base64url parts/],
    ["two parts", "a.b", /three base64url parts/],
    ["claims not JSON", `${ok.split(".")[0]}.bm90anNvbg.${ok.split(".")[2]}`, /three base64url parts/],
    ["HS256", `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${ok.split(".")[1]}.${ok.split(".")[2]}`, /not ES256/],
    ["admin", mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: 0, write: true }), /admin token \(sub 0/],
    ["another account", mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: 1, write: true }), /account 1, not the configured account 9/],
    ["read-only", mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: 9, write: false }), /read-only/],
    ["expired", mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(-1), sub: 9, write: true }), /expired at 2026-09-25T00:00:00.000Z/],
    ["sub as a string", mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: inDays(30), sub: "9" as unknown as number, write: true }), /integer sub/],
    ["no exp", mintZkoolToken(ZKOOL_PRIVATE_PEM, { sub: 9, write: true } as unknown as { exp: number; sub: number; write: boolean }), /integer exp/],
  ];
  for (const [name, token, re] of cases) {
    const m = refusal(() => checkZkoolToken(token, 9, NOW));
    assert.match(m, re, name);
    for (const part of token.split(".")) if (part.length > 8) assert.ok(!m.includes(part), `${name}: the message never holds the token`);
  }
});

test("the token file: read and trimmed; refused when missing, or open to group or others (as OpenSSH refuses a private key)", () => {
  const good = zkoolTokenFile(9);
  const read = readZkoolToken(good, 9);
  assert.equal(read.token, readFileSync(good, "utf8").trim());
  assert.ok(read.expiresAt.getTime() > Date.now());
  assert.match(refusal(() => readZkoolToken(join(dir, "missing.jwt"), 9)), /cannot be read \(ENOENT\)/);
  for (const mode of [0o640, 0o604, 0o644]) {
    const f = zkoolTokenFile(9, {}, { mode });
    assert.match(refusal(() => readZkoolToken(f, 9)), new RegExp(`mode ${mode.toString(8)}\\); chmod 600`), mode.toString(8));
  }
});

test("boot: every refusal is a ConfigError naming ZECEIPT_ZKOOL_TOKEN_FILE, never the token; external custody reads nothing", () => {
  const base = {
    ZECEIPT_CUSTODY_MODE: "hot", ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql", ZECEIPT_ZKOOL_ACCOUNT: "9",
    ZECEIPT_DB_PATH: "/var/lib/zeceipt/c.db", ZECEIPT_ORG_ID: "o", ZECEIPT_NETWORK: "regtest", ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
    ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/z", ZECEIPT_UFVK_FILE: "/etc/u", ZECEIPT_ISSUER_KEY_FILE: "/etc/k", ZECEIPT_ISSUER_KEY_ID: "k",
    ZECEIPT_RECEIPT_HOST: "https://receipts.example", ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: zkoolPublicKeyFile(),
  };
  const admin = zkoolToken(0);
  for (const [name, file] of [["admin", zkoolTokenFile(0)], ["other account", zkoolTokenFile(4)], ["open file", zkoolTokenFile(9, {}, { mode: 0o644 })], ["garbage", zkoolTokenFile(9, {}, { text: "not-a-token" })]] as const) {
    try {
      loadZkoolToken(loadConfig({ ...base, ZECEIPT_ZKOOL_TOKEN_FILE: file }));
      assert.fail(`${name}: should refuse`);
    } catch (e) {
      assert.ok(e instanceof ConfigError, `${name}: ${e}`);
      assert.deepEqual(e.problems.map((p) => p.variable), ["ZECEIPT_ZKOOL_TOKEN_FILE"], name);
      assert.ok(!e.message.includes(admin.split(".")[2]) && !e.message.includes(readFileSync(file, "utf8").trim().split(".").pop()!), `${name}: no token in the message`);
    }
  }
  const t = loadZkoolToken(loadConfig({ ...base, ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9) }));
  assert.ok(t && t.token.split(".").length === 3);
  assert.equal(loadZkoolToken(loadConfig({ ...base, ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_ZKOOL_URL: undefined, ZECEIPT_ZKOOL_ACCOUNT: undefined, ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: undefined })), undefined);

  // Slice S3c: the signature, checked at boot as Zkool checks it.
  const refusedOn = (env: Record<string, string | undefined>) => {
    try {
      loadZkoolToken(loadConfig({ ...base, ...env }));
    } catch (e) {
      assert.ok(e instanceof ConfigError, String(e));
      return { variables: e.problems.map((p) => p.variable), message: e.message };
    }
    assert.fail("should refuse");
  };
  const foreign = foreignZkoolToken(9);
  const signed = refusedOn({ ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9, {}, { text: foreign }) });
  assert.deepEqual(signed.variables, ["ZECEIPT_ZKOOL_TOKEN_FILE"]);
  assert.match(signed.message, /not signed by the key in ZECEIPT_ZKOOL_PUBLIC_KEY_FILE/);
  assert.ok(!signed.message.includes(foreign.split(".")[2]), "never the token");
  const keyFile = (text: string) => {
    const p = join(dir, `key-${Math.random().toString(36).slice(2)}.pem`);
    writeFileSync(p, text);
    return p;
  };
  for (const [name, file, re] of [
    ["missing", join(dir, "no-such.pub"), /cannot be read \(ENOENT\)/],
    ["not PEM", keyFile("hello"), /does not hold a public key in PEM/],
    ["a private key", keyFile(ZKOOL_PRIVATE_PEM), /never the private key/],
    ["a P-384 key", keyFile(freshKey("secp384r1").publicKey), /EC P-256 public key/],
  ] as const) {
    const r = refusedOn({ ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(9), ZECEIPT_ZKOOL_PUBLIC_KEY_FILE: file });
    assert.deepEqual(r.variables, ["ZECEIPT_ZKOOL_PUBLIC_KEY_FILE"], name);
    assert.match(r.message, re, name);
  }
});

test("the client sends the token as a bearer header; without one, or with a bad one, Zkool's filter refuses (ZkoolAuthError); another account's token is Unauthorized", async () => {
  const token = zkoolToken(9);
  const client = new ZkoolClient({ url: fake.url, token, timeoutMs: 2_000 });
  assert.equal(await client.currentHeight(), fake.height);
  assert.equal(fake.lastAuthorization, `Bearer ${token}`);
  assert.equal((await client.balance(9)).height, fake.scanned);
  await assert.rejects(new ZkoolClient({ url: fake.url, timeoutMs: 2_000 }).currentHeight(), ZkoolAuthError);
  assert.equal(fake.lastAuthorization, undefined, "no header without a token");
  await assert.rejects(new ZkoolClient({ url: fake.url, token: zkoolToken(9, { exp: inDays(-2) }), timeoutMs: 2_000 }).currentHeight(), ZkoolAuthError, "expired");
  await assert.rejects(new ZkoolClient({ url: fake.url, token: "abc.def.ghi", timeoutMs: 2_000 }).currentHeight(), ZkoolAuthError, "garbage");
  await assert.rejects(new ZkoolClient({ url: fake.url, token: zkoolToken(1), timeoutMs: 2_000 }).balance(9), /Unauthorized/);
  // The error names the endpoint and the cause, never the token.
  try {
    await new ZkoolClient({ url: fake.url, token: "abc.def.ghi", timeoutMs: 2_000 }).currentHeight();
  } catch (e) {
    assert.match((e as Error).message, /refused the token \(missing, invalid or expired\)/);
    assert.ok(!(e as Error).message.includes("abc.def.ghi"));
  }
  assert.ok(!JSON.stringify(client).includes(token.split(".")[2]), "the token is not in the client's JSON");
});

const R = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
const batch = (id: string): Batch => ({ id, network: "regtest", items: [{ payableId: "p-1", address: R, zat: 1_000_000n, memo: `${id}-INV-1` }] });
const backend = (client: ZkoolClient, now?: () => Date) => new ZkoolBackend({ client, account: 9, store: new MemoryIdempotencyStore(), ...(now ? { now } : {}) });

test("a token that expires before an attempt could finish: preflight says zkool_token_expiring, nothing is paid, the attempt stays retryable", async () => {
  const calls = fake.payCalls;
  const soon = new Date(Date.now() + 2 * 60_000); // 2 min: less than the pay timeout (300 s) + 60 s
  const client = new ZkoolClient({ url: fake.url, token: zkoolToken(9), tokenExpiresAt: soon, timeoutMs: 2_000 });
  const b = backend(client);
  const pre = await b.preflight(batch("s3-soon"));
  assert.deepEqual(pre.problems.map((p) => p.code), ["zkool_token_expiring"]);
  assert.match(pre.problems[0].detail ?? "", /expires at .*mint a new one \(scripts\/zkool-token\.ts\) and restart/);
  await assert.rejects(b.submit(batch("s3-soon"), "n-s3-soon"), PreflightFailedError);
  assert.equal((await b.store.get("n-s3-soon"))?.state, "failed_retryable");
  assert.equal(fake.payCalls, calls, "no pay call");
  // An hour left: no problem.
  const later = new ZkoolClient({ url: fake.url, token: zkoolToken(9), tokenExpiresAt: new Date(Date.now() + 3_600_000), timeoutMs: 2_000 });
  assert.deepEqual((await backend(later).preflight(batch("s3-later"))).problems, []);
});

test("a refusal of the token is never an unknown outcome: filter refusals and Unauthorized on pay leave the attempt retryable, nothing paid", async () => {
  // Preflight passes with a good token; then the pay call carries one Zkool refuses. A client whose token is swapped
  // between calls models an expiry (or a revocation) landing exactly between preflight and pay.
  const good = zkoolToken(9);
  for (const [name, bad] of [["expired at pay", zkoolToken(9, { exp: inDays(-2) })], ["read-only at pay", zkoolToken(9, { write: false })]] as const) {
    const calls = fake.payCalls;
    let n = 0;
    const swap: typeof fetch = (input, init) => {
      const headers = { ...(init?.headers as Record<string, string>) };
      if (String(init?.body).includes("pay(")) headers.authorization = `Bearer ${bad}`;
      n++;
      return fetch(input, { ...init, headers });
    };
    const b = backend(new ZkoolClient({ url: fake.url, token: good, timeoutMs: 2_000, fetch: swap }));
    await assert.rejects(b.submit(batch(`s3-${n}-${name}`), `n-${name}`), PaymentRejectedError, name);
    assert.equal((await b.store.get(`n-${name}`))?.state, "failed_retryable", name);
    assert.equal(fake.payCalls, calls, `${name}: the fake never ran pay`);
  }
});

test("the mint script: a new 0600 file, the claims asked for, never the token on stdout; refuses to overwrite, admin, and a bad lifetime", async () => {
  const key = join(dir, "k.pem");
  writeFileSync(key, ZKOOL_PRIVATE_PEM, { mode: 0o600 });
  const out = join(dir, "account-9.jwt");
  const script = join(import.meta.dirname, "../scripts/zkool-token.ts");
  const r = await run(process.execPath, [script, "--key", key, "--account", "9", "--out", out, "--days", "7"]);
  assert.match(r.stdout, /^wrote .*account-9\.jwt: Zkool account 9, write, expires 20\d\d-/);
  const token = readFileSync(out, "utf8").trim();
  assert.ok(!r.stdout.includes(token.split(".")[2]) && !r.stderr.includes(token.split(".")[2]), "the token is never printed");
  assert.equal(statSync(out).mode & 0o777, 0o600);
  const claims = verifyZkoolToken(token, ZKOOL_PUBLIC_PEM)!;
  assert.equal(claims.sub, 9);
  assert.equal(claims.write, true);
  assert.ok(Math.abs(claims.exp - (Date.now() / 1000 + 7 * 86_400)) < 60);
  for (const [args, re] of [
    [["--account", "9", "--out", out], /must not exist yet/],
    [["--account", "0", "--out", join(dir, "a0.jwt")], /admin token/],
    [["--account", "9", "--out", join(dir, "d.jwt"), "--days", "366"], /1 to 365/],
  ] as const) {
    await assert.rejects(run(process.execPath, [script, "--key", key, ...args]), (e: { code: number; stderr: string }) => e.code === 2 && re.test(e.stderr));
  }
});

// Slice S3b: a token protects nothing if Zkool does not ask for one.
test("servesWithoutToken: false when Zkool refuses a request without a token, true when it serves it; any other answer throws (slice S3b)", async () => {
  const token = zkoolToken(9);
  assert.equal(await new ZkoolClient({ url: fake.url, token, timeoutMs: 2_000 }).servesWithoutToken(), false);
  assert.equal(fake.lastAuthorization, undefined, "the probe carries no authorization header");
  const open = await new FakeZkool().start();
  try {
    assert.equal(await new ZkoolClient({ url: open.url, token, timeoutMs: 2_000 }).servesWithoutToken(), true);
  } finally {
    await open.stop();
  }
  const odd: typeof fetch = async () => new Response("boom", { status: 500 });
  await assert.rejects(new ZkoolClient({ url: fake.url, token, timeoutMs: 2_000, fetch: odd }).servesWithoutToken(), ZkoolTransportError);
  const html: typeof fetch = async () => new Response("<html>", { status: 200 });
  await assert.rejects(new ZkoolClient({ url: fake.url, token, timeoutMs: 2_000, fetch: html }).servesWithoutToken(), ZkoolTransportError);
});

test("a console with a token never pays through a Zkool that serves requests without one: zkool_unauthenticated, nothing paid (slice S3b)", async () => {
  const open = await new FakeZkool().start();
  try {
    const b = backend(new ZkoolClient({ url: open.url, token: zkoolToken(9), tokenExpiresAt: new Date(Date.now() + 3_600_000), timeoutMs: 2_000 }));
    const pre = await b.preflight(batch("s3b-open"));
    assert.deepEqual(pre.problems.map((p) => p.code), ["zkool_unauthenticated"]);
    assert.match(pre.problems[0].detail ?? "", /anyone who can reach it can pay from this wallet; restart it with --jwt-public-key-file/);
    await assert.rejects(b.submit(batch("s3b-open"), "n-s3b-open"), PreflightFailedError);
    assert.equal(open.payCalls, 0, "no pay call");
    assert.equal((await b.store.get("n-s3b-open"))?.state, "failed_retryable");
    // A client without a token (library use; never the console in hot custody) is not probed.
    const before = open.requests;
    await backend(new ZkoolClient({ url: open.url, timeoutMs: 2_000 })).preflight(batch("s3b-none"));
    assert.equal(open.requests - before, 2, "sync and balance only, no probe");
  } finally {
    await open.stop();
  }
  // Against a Zkool that asks for tokens, the same client pays.
  const calls = fake.payCalls;
  const r = await backend(new ZkoolClient({ url: fake.url, token: zkoolToken(9), tokenExpiresAt: new Date(Date.now() + 3_600_000), timeoutMs: 2_000 })).submit(batch("s3b-closed"), "n-s3b-closed");
  assert.equal(r.via, "fresh");
  assert.equal(fake.payCalls, calls + 1);
});
