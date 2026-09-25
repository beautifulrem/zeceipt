// Slice W2a: the console's issuer key-id rule is the spec §7 rule, checked against the vectors generated from its one
// definition (zeceipt-types `claim`), so the console accepts exactly the key ids that claim a domain there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isIssuerKeyId, keyIdClaim } from "../lib/issuance/key-id.ts";
import { loadConfig, ConfigError } from "../lib/index.ts";

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "../../../spec/test-vectors/binding-claims-v0.json"), "utf8")) as {
  cases: { key_id: string; why: string; claim: { label: string; domain: string; url: string } | null }[];
};

test("keyIdClaim agrees with every committed claim vector (spec §7, generated from zeceipt-types)", () => {
  assert.ok(vectors.cases.length >= 20);
  for (const c of vectors.cases) assert.deepEqual(keyIdClaim(c.key_id) ?? null, c.claim, `${c.why}: ${c.key_id}`);
});

test("the console signs with a plain label or a label that claims a domain; nothing else", () => {
  for (const c of vectors.cases) {
    const plain = !c.key_id.includes("@") && /^[A-Za-z0-9._-]{1,64}$/.test(c.key_id);
    assert.equal(isIssuerKeyId(c.key_id), plain || c.claim !== null, `${c.why}: ${c.key_id}`);
  }
  const base = {
    ZECEIPT_CUSTODY_MODE: "external", ZECEIPT_DB_PATH: "/var/lib/zeceipt/c.db", ZECEIPT_ORG_ID: "o", ZECEIPT_NETWORK: "regtest",
    ZECEIPT_WRAP_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`, ZECEIPT_LIGHTWALLETD_URL: "http://127.0.0.1:8137", ZECEIPT_BIN: "/opt/z",
    ZECEIPT_UFVK_FILE: "/etc/u", ZECEIPT_ISSUER_KEY_FILE: "/etc/k", ZECEIPT_RECEIPT_HOST: "https://receipts.example",
  };
  assert.equal(loadConfig({ ...base, ZECEIPT_ISSUER_KEY_ID: "2026-09@pay.example.org" }).issuer.keyId, "2026-09@pay.example.org");
  assert.equal(loadConfig({ ...base, ZECEIPT_ISSUER_KEY_ID: "2026-09" }).issuer.keyId, "2026-09");
  for (const bad of ["2026-09@pаy.example.org", "2026-09@Pay.example.org", "a@b@example.org"]) {
    assert.throws(() => loadConfig({ ...base, ZECEIPT_ISSUER_KEY_ID: bad }), (e: unknown) => e instanceof ConfigError && e.problems[0].variable === "ZECEIPT_ISSUER_KEY_ID", bad);
  }
});
