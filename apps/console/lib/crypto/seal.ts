// Sealing secrets at rest (design `.trellis/tasks/09-23-receipts-sealed/design.md`): AES-256-GCM with a
// 96-bit random IV (NIST SP 800-38D), a per-org key derived by HKDF-SHA256 from a deployment wrap key held
// outside the database (RFC 5869), and an encryption context bound as additional authenticated data (the
// AWS Encryption SDK's practice), so a sealed value only opens for the row it was written for. The
// envelope names its key id; the keyring's last key seals and every listed key opens (Rails' rotation model).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { SecretBytes } from "./secret.ts";
import { ExecutionError } from "../execution/types.ts";

const SALT = "zeceipt/wrap/v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Typed failure; messages never echo key material or the sealed input. */
export class SealError extends ExecutionError {
  constructor(code: "seal_unknown_kid" | "seal_malformed" | "seal_auth_failed", detail: string) {
    super(code, detail);
  }
}

export interface WrapKey {
  /** Key id stored with every sealed value (1–32 of [A-Za-z0-9_-]; shorter than any base64 key). */
  kid: string;
  /** 32 random bytes from the deployment's secret store (wrap in SecretBytes wherever it is held). */
  key: Uint8Array | SecretBytes;
}

export class Keyring {
  // Runtime-private (#): invisible to JSON, spread, structuredClone and inspect.
  readonly #keys: Map<string, Buffer>;
  readonly #derived = new Map<string, Buffer>();
  /** The kid new values are sealed under: the last key given. */
  readonly current: string;

  constructor(keys: WrapKey[]) {
    if (keys.length === 0) throw new RangeError("keyring needs at least one wrap key");
    this.#keys = new Map();
    for (const k of keys) {
      // ≤ 32 characters: a 32-byte key in base64 is ≥ 43, so a key can never pass for (and be shown as) an id.
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(k.kid)) throw new RangeError("key id must be 1–32 characters of [A-Za-z0-9_-]");
      if (this.#keys.has(k.kid)) throw new RangeError(`duplicate key id ${k.kid}`);
      // Structural, not `instanceof SecretBytes`: the config may come from another bundle's copy of the
      // library (Next loads it twice; slice E1), and a Uint8Array is always the global class.
      const bytes = k.key instanceof Uint8Array ? k.key : k.key.reveal();
      if (bytes.length !== 32) throw new RangeError(`wrap key ${k.kid} must be 32 bytes`);
      this.#keys.set(k.kid, Buffer.from(bytes));
    }
    this.current = keys[keys.length - 1].kid;
  }

  /** Key ids only. */
  get kids(): string[] {
    return [...this.#keys.keys()];
  }
  toJSON(): { kids: string[]; current: string } {
    return { kids: this.kids, current: this.current };
  }
  [inspect.custom](): string {
    return `Keyring { kids: ${JSON.stringify(this.kids)}, current: ${JSON.stringify(this.current)} }`;
  }

  has(kid: string): boolean {
    return this.#keys.has(kid);
  }

  /** HKDF-SHA256(ikm = wrap key, salt = "zeceipt/wrap/v1", info = "org:" + orgId) → 32 bytes. */
  orgKey(kid: string, orgId: string): Buffer {
    const wrap = this.#keys.get(kid);
    if (!wrap) throw new SealError("seal_unknown_kid", "the sealed value names a key id this keyring does not hold");
    if (!orgId) throw new RangeError("orgId is required");
    const cacheKey = `${kid}\u0000${orgId}`;
    let k = this.#derived.get(cacheKey);
    if (!k) {
      k = Buffer.from(hkdfSync("sha256", wrap, SALT, `org:${orgId}`, 32));
      this.#derived.set(cacheKey, k);
    }
    return k;
  }
}

/** Canonical AAD: the context object with sorted keys, plus the org, as JSON. `org` is reserved. */
function aad(orgId: string, context: Record<string, string | number>): Buffer {
  if (Object.hasOwn(context, "org")) throw new RangeError("the context key \"org\" is reserved (the org is always bound)");
  const entries = Object.entries({ ...context, org: orgId }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8");
}

const b64 = (b: Buffer) => b.toString("base64url");

export function seal(keyring: Keyring, orgId: string, context: Record<string, string | number>, plaintext: Uint8Array): string {
  const kid = keyring.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.orgKey(kid, orgId), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(orgId, context));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({ v: 1, kid, iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) });
}

/** The kid a sealed value was written under (without opening it). */
export function sealedKid(envelope: string): string {
  return parse(envelope).kid;
}

/** Strict base64url: only the alphabet, and it must re-encode to itself (Node's decoder skips junk). */
function b64strict(s: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return undefined;
  const b = Buffer.from(s, "base64url");
  return b.toString("base64url") === s ? b : undefined;
}

function parse(envelope: string): { kid: string; iv: Buffer; tag: Buffer; ct: Buffer } {
  const malformed = () => new SealError("seal_malformed", "sealed value is not a valid envelope");
  let e: unknown;
  try {
    e = JSON.parse(envelope);
  } catch {
    throw malformed();
  }
  const o = e as { v?: unknown; kid?: unknown; iv?: unknown; tag?: unknown; ct?: unknown };
  if (typeof e !== "object" || e === null || Array.isArray(e)) throw malformed();
  if (Object.keys(o).sort().join(",") !== "ct,iv,kid,tag,v") throw malformed(); // exactly the known fields
  if (o.v !== 1 || typeof o.kid !== "string" || typeof o.iv !== "string" || typeof o.tag !== "string" || typeof o.ct !== "string") throw malformed();
  const iv = b64strict(o.iv);
  const tag = b64strict(o.tag);
  const ct = b64strict(o.ct);
  if (!iv || !tag || !ct || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw malformed();
  return { kid: o.kid, iv, tag, ct };
}

export function open(keyring: Keyring, orgId: string, context: Record<string, string | number>, envelope: string): Buffer {
  const e = parse(envelope);
  const decipher = createDecipheriv("aes-256-gcm", keyring.orgKey(e.kid, orgId), e.iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(orgId, context));
  decipher.setAuthTag(e.tag);
  try {
    return Buffer.concat([decipher.update(e.ct), decipher.final()]);
  } catch {
    // Wrong row/org/key, or tampered IV, tag or ciphertext: GCM cannot tell which, and neither do we.
    throw new SealError("seal_auth_failed", "sealed value does not open for this context");
  }
}
