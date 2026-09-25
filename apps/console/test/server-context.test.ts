// Server context and boot (slice C2): one boot per process, migrations applied from an explicit folder,
// the wrap keys scrubbed from the environment, fail-closed reads before boot, failure lines without
// secrets, and the health response (IETF health+json) for pass and fail.

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootFailureLines,
  bootServerContext,
  ConfigError,
  ContextNotReadyError,
  defaultMigrationsDir,
  migrateDb,
  openDb,
  SERVER_CONTEXT_KEY,
  serverContext,
  type BootState,
  type ServerContext,
} from "../lib/index.ts";
import { HEALTH_CONTENT_TYPE, healthResponse } from "../lib/server/health.ts";
import { zkoolTokenFile } from "./helpers/zkool-token.ts";

const KEY = Buffer.alloc(32, 0x5c);
const KEY_B64 = KEY.toString("base64");
const dir = mkdtempSync(join(tmpdir(), "zeceipt-ctx-"));
const env = (name: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  ZECEIPT_CUSTODY_MODE: "hot",
  ZECEIPT_ZKOOL_URL: "http://127.0.0.1:9000/graphql",
  ZECEIPT_ZKOOL_ACCOUNT: "1", ZECEIPT_ZKOOL_TOKEN_FILE: zkoolTokenFile(1),
  ZECEIPT_DB_PATH: join(dir, `${name}.db`),
  ZECEIPT_ORG_ID: "demo-org",
  ZECEIPT_NETWORK: "regtest",
  ZECEIPT_WRAP_KEYS: `k1:${KEY_B64}`,
  ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137",
  ZECEIPT_BIN: "/opt/zeceipt/bin/zeceipt",
  ZECEIPT_UFVK_FILE: "/etc/zeceipt/ufvk.txt",
  ZECEIPT_ISSUER_KEY_FILE: "/etc/zeceipt/issuer.key",
  ZECEIPT_ISSUER_KEY_ID: "2026-09", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  UNRELATED: "kept",
  ...extra,
});
const opts = { migrationsFolder: defaultMigrationsDir() };
const slot = globalThis as { [SERVER_CONTEXT_KEY]?: BootState };
const journalEntries = () =>
  (JSON.parse(readFileSync(join(defaultMigrationsDir(), "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries.length;
const applied = (ctx: ServerContext) => (ctx.db.$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
/** C1's detector: the key in base64 (and a prefix), base64url, hex, and as byte numbers. */
const assertNoKey = (text: string) => {
  for (const needle of [KEY_B64, KEY_B64.slice(0, 20), KEY.toString("base64url").slice(0, 20), KEY.toString("hex"), [...KEY].slice(0, 8).join(",")]) {
    assert.ok(!text.includes(needle), `key material in: ${text.slice(0, 120)}`);
  }
};

afterEach(() => {
  const ctx = slot[SERVER_CONTEXT_KEY];
  if (ctx?.db.$client.open) ctx.db.$client.close();
  delete slot[SERVER_CONTEXT_KEY];
});

test("boot: config, keyring and migrated database are published once; the wrap keys leave the environment", () => {
  const e = env("boot");
  const ctx = bootServerContext(e, opts);
  assert.equal(serverContext(), ctx);
  assert.ok(Object.isFrozen(ctx));
  assert.equal(applied(ctx), journalEntries(), "every committed migration applied");
  assert.equal(ctx.config.orgId, "demo-org");
  assert.deepEqual(ctx.keyring.kids, ["k1"]);
  assert.equal("ZECEIPT_WRAP_KEYS" in e, false, "wrap keys scrubbed after the keyring holds them");
  assert.equal(e.ZECEIPT_DB_PATH, join(dir, "boot.db"), "other variables untouched");
  assert.equal(e.UNRELATED, "kept");
});

test("boot is idempotent: a second call returns the same context and opens nothing", () => {
  const first = bootServerContext(env("once"), opts);
  const again = env("other-file");
  assert.equal(bootServerContext(again, opts), first);
  assert.equal(again.ZECEIPT_WRAP_KEYS, `k1:${KEY_B64}`, "a no-op boot scrubs nothing");
  assert.equal(first.config.dbPath, join(dir, "once.db"));
});

test("fail closed: no context before boot, nothing published after a failed boot", () => {
  assert.throws(() => serverContext(), (e: unknown) => e instanceof ContextNotReadyError && e.code === "context_not_ready");

  const bad = env("bad", { ZECEIPT_CUSTODY_MODE: "external" }); // external with a Zkool URL and account: REQ-CON-17
  assert.throws(() => bootServerContext(bad, opts), ConfigError);
  assert.equal(slot[SERVER_CONTEXT_KEY], undefined);
  assert.equal(bad.ZECEIPT_WRAP_KEYS, `k1:${KEY_B64}`, "a failed boot scrubs nothing (the process exits anyway)");

  assert.throws(() => bootServerContext(env("nodir", { ZECEIPT_DB_PATH: join(dir, "missing", "x.db") }), opts), /directory does not exist/);
  assert.equal(slot[SERVER_CONTEXT_KEY], undefined);

  const missing = join(dir, "no-migrations");
  assert.throws(
    () => bootServerContext(env("nomig"), { migrationsFolder: missing }),
    (e: unknown) => e instanceof Error && e.message.includes(join(missing, "meta", "_journal.json")) && e.message.includes("start the console from apps/console"),
  );
  assert.equal(slot[SERVER_CONTEXT_KEY], undefined);
  assert.equal(existsSync(join(dir, "nomig.db")), false, "the journal is checked before the database file is created");

  // A migration that fails after the database was opened: the handle is closed and nothing is published.
  const broken = join(dir, "broken-migrations");
  mkdirSync(join(broken, "meta"), { recursive: true });
  writeFileSync(join(broken, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: [{ idx: 0, version: "6", when: 1, tag: "0000_bad", breakpoints: true }] }));
  writeFileSync(join(broken, "0000_bad.sql"), "THIS IS NOT SQL;");
  assert.throws(() => bootServerContext(env("badmig"), { migrationsFolder: broken }));
  assert.equal(slot[SERVER_CONTEXT_KEY], undefined);
  const reopened = openDb({ path: join(dir, "badmig.db") }); // the file stays usable after the failed migration
  migrateDb(reopened, opts.migrationsFolder);
  reopened.$client.close();
});

test("failure lines name the variables and never the key", () => {
  const cases = [
    env("f1", { ZECEIPT_CUSTODY_MODE: "external" }),
    env("f2", { ZECEIPT_ZKOOL_URL: undefined }),
    env("f3", { ZECEIPT_WRAP_KEYS: `${KEY.toString("base64url")}:k1` }), // key where the id belongs
    env("f4", { ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(31, 0x5c).toString("base64")}` }), // one byte short
  ];
  const expected = [["ZECEIPT_ZKOOL_ACCOUNT", "ZECEIPT_ZKOOL_URL"], ["ZECEIPT_ZKOOL_URL"], ["ZECEIPT_WRAP_KEYS"], ["ZECEIPT_WRAP_KEYS"]];
  cases.forEach((e, i) => {
    let lines: string[] = [];
    try {
      bootServerContext(e, opts);
      assert.fail("booted");
    } catch (err) {
      lines = bootFailureLines(err);
    }
    for (const v of expected[i]) assert.ok(lines.some((l) => l.startsWith(`startup refused: ${v}: `)), `${v} in ${lines.join(" | ")}`);
    lines.forEach(assertNoKey);
  });
  assert.deepEqual(bootFailureLines(new RangeError("line one\n  line two")), ["startup refused: RangeError: line one line two"]);
  assert.deepEqual(bootFailureLines("plain"), ["startup refused: Error: plain"]);
});

test("migrateDb takes an explicit folder; the default resolves next to db/client.ts under Node", () => {
  assert.equal(defaultMigrationsDir(), join(import.meta.dirname, "..", "db", "migrations"));
  const db = openDb({ path: join(dir, "explicit.db") });
  migrateDb(db, defaultMigrationsDir());
  migrateDb(db); // default, and a second run is a no-op
  assert.equal((db.$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, journalEntries());
  db.$client.close();
});

test("health: pass (200) when booted; fail (503) before boot or when the database cannot answer; no internals", async () => {
  const read = async (r: Response) => ({ code: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), body: await r.json() });
  const fail = { status: "fail", checks: { "sqlite:responsiveness": [{ status: "fail" }] } };

  assert.deepEqual(await read(healthResponse()), { code: 503, type: HEALTH_CONTENT_TYPE, cache: "no-store", body: fail });

  const ctx = bootServerContext(env("health"), opts);
  assert.deepEqual(await read(healthResponse()), {
    code: 200,
    type: HEALTH_CONTENT_TYPE,
    cache: "no-store",
    body: { status: "pass", checks: { "sqlite:responsiveness": [{ status: "pass" }] } },
  });

  ctx.db.$client.close();
  assert.deepEqual(await read(healthResponse()), { code: 503, type: HEALTH_CONTENT_TYPE, cache: "no-store", body: fail });
});
