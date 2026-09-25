// Zkool tokens for tests (slice S3): one P-256 key pair per process, and token files written 0600 as the mint
// script writes them. FakeZkool.requireTokens(ZKOOL_PUBLIC_PEM) makes the fake check them as Zkool does.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintZkoolToken, type ZkoolClaims } from "../../lib/execution/zkool-token.ts";

const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const ZKOOL_PRIVATE_PEM = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const ZKOOL_PUBLIC_PEM = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

const dir = mkdtempSync(join(tmpdir(), "zeceipt-zkool-token-"));
let n = 0;

/** A token for `account` (write, 30 days unless overridden), minted with this process's key. */
export const zkoolToken = (account: number | string, claims: Partial<ZkoolClaims> = {}) =>
  mintZkoolToken(ZKOOL_PRIVATE_PEM, { exp: Math.floor(Date.now() / 1000) + 30 * 86_400, sub: Number(account), write: true, ...claims });

/** Write a token (or any text) to a new file with `mode` (0600 by default); returns its absolute path. */
export function zkoolTokenFile(account: number | string, claims: Partial<ZkoolClaims> = {}, opts: { mode?: number; text?: string } = {}): string {
  const path = join(dir, `token-${process.pid}-${n++}.jwt`);
  writeFileSync(path, `${opts.text ?? zkoolToken(account, claims)}\n`, { mode: opts.mode ?? 0o600 });
  return path;
}

let publicKeyPath: string | undefined;
/** The public key Zkool would be started with, for this process's tokens (slice S3c); written once. */
export function zkoolPublicKeyFile(): string {
  if (!publicKeyPath) {
    publicKeyPath = join(dir, "zkool-jwt.pub");
    writeFileSync(publicKeyPath, ZKOOL_PUBLIC_PEM);
  }
  return publicKeyPath;
}

/** A token for `account` signed by another P-256 key: scope right, signature wrong for ZKOOL_PUBLIC_PEM (slice S3c). */
const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const foreignZkoolToken = (account: number | string) =>
  mintZkoolToken(other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { exp: Math.floor(Date.now() / 1000) + 30 * 86_400, sub: Number(account), write: true });
