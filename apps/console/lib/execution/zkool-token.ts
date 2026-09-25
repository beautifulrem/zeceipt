// Zkool's API credential (slice S3, research log R97). zkool_graphql listens on every interface and, started with
// `--jwt-public-key-file`, refuses any request without an ES256 JWT whose claims are `{exp, sub, write}` (zkool2
// `graphql/jwt.rs`): `sub` is the one account the token may use (0 = admin, every account) and `write` allows
// mutations such as `pay` (`graphql/mod.rs` `check_auth`). The console holds a token scoped to its own account,
// never the signing key: with the key it could mint admin tokens. It checks the token's scope at startup (it cannot
// check the signature; Zkool does), sends it from memory and never logs it.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export interface ZkoolClaims {
  /** Expiry, seconds since the Unix epoch. */
  exp: number;
  /** The account the token may use; 0 is admin. */
  sub: number;
  /** Mutations (`pay`, `synchronizeAccount`'s write side) need it. */
  write: boolean;
}

/** Our message only: never the token or any part of it. */
export class ZkoolTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZkoolTokenError";
  }
}

const HEADER = { alg: "ES256", typ: "JWT" };
const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Mint a token (the mint script; tests). ES256 signatures are R‖S, 64 bytes (RFC 7518 §3.4), not DER. */
export function mintZkoolToken(privateKeyPem: string, claims: ZkoolClaims): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new ZkoolTokenError("the key must be an EC P-256 private key (ES256)");
  }
  const input = `${b64u(JSON.stringify(HEADER))}.${b64u(JSON.stringify(claims))}`;
  return `${input}.${b64u(sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }))}`;
}

function decode(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; input: string; sig: Buffer } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return undefined;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof header !== "object" || header === null || typeof claims !== "object" || claims === null) return undefined;
    return { header, claims, input: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2], "base64url") };
  } catch {
    return undefined;
  }
}

/**
 * Zkool's own check (the test double uses it): ES256 only, the signature, and `exp` with jsonwebtoken's default
 * 60 s leeway (`Validation::new(Algorithm::ES256)`, `validate_exp = true`). The claims, or undefined.
 */
export function verifyZkoolToken(token: string, publicKeyPem: string, now = new Date()): ZkoolClaims | undefined {
  const d = decode(token);
  if (!d || d.header.alg !== "ES256") return undefined;
  if (!verify("sha256", Buffer.from(d.input), { key: createPublicKey(publicKeyPem), dsaEncoding: "ieee-p1363" }, d.sig)) return undefined;
  const { exp, sub, write } = d.claims;
  if (!Number.isInteger(exp) || !Number.isInteger(sub) || typeof write !== "boolean") return undefined;
  if ((exp as number) + 60 < now.getTime() / 1000) return undefined;
  return { exp: exp as number, sub: sub as number, write };
}

/**
 * The console's scope check, before any request: an ES256 token for exactly `account` (never admin), with `write`
 * (the console pays), not expired. The signature is Zkool's to check.
 */
export function checkZkoolToken(token: string, account: number, now = new Date()): { expiresAt: Date } {
  const d = decode(token);
  if (!d) throw new ZkoolTokenError("does not hold a JWT (three base64url parts: header, claims, signature)");
  if (d.header.alg !== "ES256") throw new ZkoolTokenError("holds a token that is not ES256 (Zkool accepts ES256 only)");
  const { exp, sub, write } = d.claims;
  if (!Number.isInteger(sub)) throw new ZkoolTokenError("holds a token without an integer sub (the Zkool account)");
  if (sub === 0) throw new ZkoolTokenError(`holds an admin token (sub 0, every account); mint one for account ${account} only`);
  if (sub !== account) throw new ZkoolTokenError(`holds a token for Zkool account ${sub as number}, not the configured account ${account}`);
  if (write !== true) throw new ZkoolTokenError("holds a read-only token (write is not true); the console pays, so it needs write");
  if (!Number.isInteger(exp)) throw new ZkoolTokenError("holds a token without an integer exp (Zkool requires an expiry)");
  const expiresAt = new Date((exp as number) * 1000);
  if (expiresAt.getTime() <= now.getTime()) throw new ZkoolTokenError(`holds a token that expired at ${expiresAt.toISOString()}; mint a new one`);
  return { expiresAt };
}

/** Read and check the token file. Like OpenSSH with a private key, a file other users can read or write is refused. */
export function readZkoolToken(path: string, account: number, now = new Date()): { token: string; expiresAt: Date } {
  let mode: number;
  let text: string;
  try {
    mode = statSync(path).mode;
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ZkoolTokenError(`cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})`);
  }
  if (mode & 0o077) throw new ZkoolTokenError(`is accessible to group or others (mode ${(mode & 0o777).toString(8)}); chmod 600 it`);
  const token = text.trim();
  return { token, ...checkZkoolToken(token, account, now) };
}
