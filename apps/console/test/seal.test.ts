// Sealing at rest (slice B2): HKDF usage checked against RFC 5869, AES-256-GCM round trip, binding to the
// encryption context (row, org, kid), tamper detection, IV uniqueness, and keyring validation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hkdfSync, randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { Keyring, openSealed, seal, SealError, sealedKid, SecretBytes } from "../lib/index.ts";

const k1 = { kid: "k1", key: Buffer.alloc(32, 1) };
const k2 = { kid: "k2", key: Buffer.alloc(32, 2) };
const ctx = { purpose: "receipt", txid: "ab".repeat(32), pool: "ironwood", index: 2 };
const secret = Buffer.from('{"ock":"AAAA","url":"https://zeceipt.xyz/r/eyJ..."}');

test("HKDF-SHA256 as called by the keyring reproduces RFC 5869 Test Case 1", () => {
  const okm = hkdfSync("sha256", Buffer.alloc(22, 0x0b), Buffer.from("000102030405060708090a0b0c", "hex"), Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex"), 42);
  assert.equal(Buffer.from(okm).toString("hex"), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  // The keyring derives distinct 32-byte keys per org and per kid, deterministically.
  const ring = new Keyring([k1, k2]);
  assert.equal(ring.orgKey("k1", "org-a").length, 32);
  assert.deepEqual(ring.orgKey("k1", "org-a"), new Keyring([k1]).orgKey("k1", "org-a"));
  assert.notDeepEqual(ring.orgKey("k1", "org-a"), ring.orgKey("k1", "org-b"));
  assert.notDeepEqual(ring.orgKey("k1", "org-a"), ring.orgKey("k2", "org-a"));
  assert.deepEqual(ring.orgKey("k1", "org-a"), Buffer.from(hkdfSync("sha256", k1.key, "zeceipt/wrap/v1", "org:org-a", 32)));
});

test("seal → open round trip; the envelope names the newest kid and carries no plaintext", () => {
  const ring = new Keyring([k1, k2]);
  const env = seal(ring, "org-a", ctx, secret);
  assert.equal(sealedKid(env), "k2");
  assert.deepEqual(openSealed(ring, "org-a", ctx, env), secret);
  for (const needle of ["ock", "AAAA", "zeceipt.xyz", "eyJ"]) assert.ok(!env.includes(needle), needle);
  const parsed = JSON.parse(env);
  assert.deepEqual(Object.keys(parsed).sort(), ["ct", "iv", "kid", "tag", "v"]);
  assert.equal(Buffer.from(parsed.iv, "base64url").length, 12);
  assert.equal(Buffer.from(parsed.tag, "base64url").length, 16);
});

test("a sealed value opens only for its own row, org and key; tampering is detected", () => {
  const ring = new Keyring([k1]);
  const env = seal(ring, "org-a", ctx, secret);
  const authFailed = (e: unknown) => e instanceof SealError && e.code === "seal_auth_failed" && !String(e.message).includes("ock");
  assert.throws(() => openSealed(ring, "org-a", { ...ctx, index: 3 }, env), authFailed, "another output of the same tx");
  assert.throws(() => openSealed(ring, "org-a", { ...ctx, txid: "cd".repeat(32) }, env), authFailed, "another tx");
  assert.throws(() => openSealed(ring, "org-a", { ...ctx, purpose: "ufvk" }, env), authFailed, "another purpose");
  assert.throws(() => openSealed(ring, "org-b", ctx, env), authFailed, "another org");
  const flip = (field: "iv" | "tag" | "ct") => {
    const o = JSON.parse(env);
    const b = Buffer.from(o[field], "base64url");
    b[0] ^= 1;
    o[field] = b.toString("base64url");
    return JSON.stringify(o);
  };
  for (const f of ["iv", "tag", "ct"] as const) assert.throws(() => openSealed(ring, "org-a", ctx, flip(f)), authFailed, `tampered ${f}`);
  // An envelope naming a kid the keyring does not hold fails before any decryption.
  const unknown = JSON.stringify({ ...JSON.parse(env), kid: "k9" });
  assert.throws(() => openSealed(ring, "org-a", ctx, unknown), (e: unknown) => e instanceof SealError && e.code === "seal_unknown_kid" && !e.message.includes("k9"));
  // Strict envelope: base64url junk and unknown fields are malformed, not silently ignored.
  const o = JSON.parse(env);
  for (const bad of [JSON.stringify({ ...o, iv: `${o.iv}!!` }), JSON.stringify({ ...o, ct: `${o.ct}=` }), JSON.stringify({ ...o, extra: 1 }), JSON.stringify([o])]) {
    assert.throws(() => openSealed(ring, "org-a", ctx, bad), (e: unknown) => e instanceof SealError && e.code === "seal_malformed", bad);
  }
  // "org" is reserved in the context: the org is always bound by the keyring call.
  assert.throws(() => seal(ring, "org-a", { ...ctx, org: "org-b" }, secret), RangeError);
  for (const bad of ["", "{}", "not json", JSON.stringify({ ...JSON.parse(env), v: 2 }), JSON.stringify({ ...JSON.parse(env), iv: "AAAA" })]) {
    assert.throws(() => openSealed(ring, "org-a", ctx, bad), (e: unknown) => e instanceof SealError && e.code === "seal_malformed", bad);
  }
});

test("IVs are unique across 1,000 seals of the same plaintext, and ciphertexts differ", () => {
  const ring = new Keyring([k1]);
  const ivs = new Set<string>();
  const cts = new Set<string>();
  for (let i = 0; i < 1_000; i++) {
    const o = JSON.parse(seal(ring, "org-a", ctx, secret));
    ivs.add(o.iv);
    cts.add(o.ct);
  }
  assert.equal(ivs.size, 1_000);
  assert.equal(cts.size, 1_000);
});

test("keyring validation: at least one key, 32-byte keys, unique well-formed kids; the last key seals", () => {
  assert.throws(() => new Keyring([]), RangeError);
  assert.throws(() => new Keyring([{ kid: "k1", key: randomBytes(31) }]), RangeError);
  assert.throws(() => new Keyring([{ kid: "a.b", key: randomBytes(32) }]), RangeError);
  assert.throws(() => new Keyring([{ kid: "", key: randomBytes(32) }]), RangeError);
  assert.throws(() => new Keyring([{ kid: "k".repeat(33), key: randomBytes(32) }]), RangeError, "ids are at most 32 characters (shorter than any base64 key)");
  // Built from SecretBytes; the keyring itself never shows key bytes.
  const secretKey = Buffer.alloc(32, 0x7e);
  const ring = new Keyring([{ kid: "s1", key: new SecretBytes(secretKey) }]);
  assert.deepEqual(openSealed(ring, "o", ctx, seal(ring, "o", ctx, secret)), secret);
  for (const out of [JSON.stringify(ring), inspect(ring, { depth: 20, showHidden: true }), JSON.stringify({ ...ring }), String(new SecretBytes(secretKey))]) {
    assert.ok(!out.includes(secretKey.toString("base64").slice(0, 16)) && !out.includes("126,126,126"), out);
  }
  assert.throws(() => new Keyring([k1, { kid: "k1", key: randomBytes(32) }]), RangeError);
  assert.equal(new Keyring([k2, k1]).current, "k1");
  assert.throws(() => new Keyring([k1]).orgKey("k1", ""), RangeError);
  // Errors never include key bytes.
  try {
    new Keyring([{ kid: "k1", key: Buffer.alloc(31, 0xab) }]);
  } catch (e) {
    assert.ok(!String((e as Error).message).includes("abab"));
  }
});
