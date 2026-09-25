// Console configuration (design `.trellis/tasks/09-23-console-config/design.md`). The ONLY module that
// reads ZECEIPT_* environment variables (Twelve-Factor config; one owner for the payload, per the
// cross-layer guide). Everything else receives the typed, frozen ConsoleConfig. Errors name the variable
// and a fixed message of ours — never the value (zod's raw issues carry the input; they are not surfaced).

import { isAbsolute } from "node:path";
import { z } from "zod";
import { Keyring } from "../crypto/seal.ts";
import { SecretBytes } from "../crypto/secret.ts";
import { LOOPBACK_HOSTS } from "../execution/zkool-client.ts";
import { ExecutionError, type Network } from "../execution/types.ts";
import { isIssuerKeyId } from "../issuance/key-id.ts";
import { readZkoolPublicKey, readZkoolToken, verifyZkoolToken, ZkoolTokenError } from "../execution/zkool-token.ts";
import { DEFAULT_MAX_DRIFT_BPS } from "../rates/drift.ts";
import { KRAKEN_TICKER_URL } from "../rates/kraken.ts";

export type CustodyConfig = { mode: "hot"; zkool: { url: string; account: number; allowRemote: boolean; tokenFile: string; publicKeyFile: string } } | { mode: "external" };

export interface ConsoleConfig {
  custody: CustodyConfig;
  dbPath: string;
  orgId: string;
  network: Network;
  confirmations: number;
  /**
   * Seconds between automatic receipt passes (slice I2; REQ-CON-11): once a batch has `confirmations`, its receipts are
   * issued without a person pressing the button. 0 turns it off; it runs only in hot custody.
   */
  autoReceiptsSeconds: number;
  /** Deployment wrap keys, in order; the last one seals. Each key is SecretBytes: redacted in every string/JSON/inspect form. */
  wrapKeys: { kid: string; key: SecretBytes }[];
  lightwalletdUrl: string;
  issuer: { bin: string; ufvkFile: string; keyFile: string; keyId: string };
  /** Where the public receipt page is served; receipt links are `<receiptHost>/r#<payload>` (spec §2.1). */
  receiptHost: string;
  /** A Kraken-format Ticker URL for ZEC/USD quotes (slice G1c1); default Kraken's own. */
  rateUrl: string;
  /** REQ-CON-21: the largest allowed move between the lock and the execution quote, in basis points (slice G2a). */
  rateMaxDriftBps: number;
}

export interface ConfigProblem {
  variable: string;
  message: string;
}

/** Startup must stop: every problem is listed (variable + message, never the value). */
export class ConfigError extends ExecutionError {
  readonly problems: ConfigProblem[];
  constructor(problems: ConfigProblem[]) {
    super("config_invalid", `invalid configuration:\n${problems.map((p) => `  ${p.variable}: ${p.message}`).join("\n")}`);
    this.problems = problems;
  }
}

const P = "ZECEIPT_";
const KNOWN = [
  "CUSTODY_MODE",
  "ZKOOL_URL",
  "ZKOOL_ACCOUNT",
  "ZKOOL_ALLOW_REMOTE",
  "ZKOOL_TOKEN_FILE",
  "ZKOOL_PUBLIC_KEY_FILE",
  "DB_PATH",
  "ORG_ID",
  "NETWORK",
  "CONFIRMATIONS",
  "AUTO_RECEIPTS_SECONDS",
  "WRAP_KEYS",
  "LIGHTWALLETD_URL",
  "BIN",
  "UFVK_FILE",
  "ISSUER_KEY_FILE",
  "ISSUER_KEY_ID",
  "RECEIPT_HOST",
  "RATE_URL",
  "RATE_MAX_DRIFT_BPS",
].map((k) => P + k);

// http(s) only, and no user:password@ part: neither Zkool nor lightwalletd uses URL credentials, and a URL is
// shown in the (loggable) summary, so credentials in it would leak.
const httpUrl = z.url({ protocol: /^https?$/ }).refine((s) => {
  // zod 4 runs refinements even after the URL check failed, so parsing must not throw here.
  try {
    const u = new URL(s);
    return u.username === "" && u.password === "";
  } catch {
    return false;
  }
}).transform((s) => new URL(s).href); // stored normalised (scheme case, trailing whitespace, default path)
// The public receipt page's base URL (GitLab's `external_url` pattern: the console is reached on loopback,
// the page lives elsewhere). Required, with no default (slice S2, R96): the page that host serves can read the
// link's fragment, which holds the receipt, so only the operator knows a safe value. https, or http only on
// loopback (a local demo): the fragment never travels, but the page's scripts do. No credentials (links are
// shared); no query or fragment (`/r#…` is appended). A path prefix is allowed; the trailing "/" is dropped, as
// the CLI's to_url does.
const receiptHostUrl = z.string().refine((s) => {
  try {
    const u = new URL(s);
    const loopback = LOOPBACK_HOSTS.has(u.hostname);
    return (u.protocol === "https:" || (u.protocol === "http:" && loopback)) && u.username === "" && u.password === "" && u.search === "" && u.hash === "" && !s.includes("?") && !s.includes("#");
  } catch {
    return false;
  }
}).transform((s) => new URL(s).href.replace(/\/+$/, ""));
// The ZEC/USD source (slice G1c1): Kraken's Ticker by default; tests and a local mirror may use loopback http.
// Same transport rules as the receipt host, except that a query is allowed (the Ticker URL has one).
const rateUrlSchema = z.string().refine((s) => {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname))) && u.username === "" && u.password === "" && u.hash === "" && !s.includes("#");
  } catch {
    return false;
  }
}).transform((s) => new URL(s).href);
const absPath = z.string().refine((s) => isAbsolute(s) && !s.startsWith("file:") && s !== ":memory:" && !/[\u0000-\u001f\u007f]/.test(s));
const intIn = (min: number, max: number) => z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));

export function loadConfig(env: Record<string, string | undefined> = process.env): ConsoleConfig {
  const problems: ConfigProblem[] = [];
  const get = (k: string) => {
    const v = env[P + k];
    return v === undefined || v === "" ? undefined : v;
  };
  /** Parse one variable with zod; on failure record OUR message (never zod's, never the value). */
  function field<T>(k: string, schema: z.ZodType<T>, message: string, opts: { required?: boolean; fallback?: T } = {}): T | undefined {
    const raw = get(k);
    if (raw === undefined) {
      if (opts.fallback !== undefined) return opts.fallback;
      if (opts.required !== false) problems.push({ variable: P + k, message: `is required (${message})` });
      return undefined;
    }
    const r = schema.safeParse(raw);
    if (!r.success) {
      problems.push({ variable: P + k, message });
      return undefined;
    }
    return r.data;
  }

  for (const k of Object.keys(env)) {
    if (k.startsWith(P) && !KNOWN.includes(k)) problems.push({ variable: k, message: "is not a known variable (typo?)" });
  }

  const mode = field("CUSTODY_MODE", z.enum(["hot", "external"]), "must be hot or external");
  let custody: CustodyConfig | undefined;
  if (mode === "hot") {
    const url = field("ZKOOL_URL", httpUrl, "must be an http(s) URL without credentials of the Zkool GraphQL endpoint (required in hot custody)");
    const account = field("ZKOOL_ACCOUNT", intIn(0, 2 ** 31 - 1), "must be the Zkool account id, an integer ≥ 0 (required in hot custody)");
    const allowRemote = field("ZKOOL_ALLOW_REMOTE", z.enum(["true", "false"]).transform((s) => s === "true"), "must be true or false", { fallback: false });
    // Zkool listens on every interface and serves anyone unless started with --jwt-public-key-file (slice S3, R97): the
    // console holds a token scoped to its account; the file's contents are checked at boot (lib/execution/zkool-token.ts).
    const tokenFile = field("ZKOOL_TOKEN_FILE", absPath, "must be the absolute path of the Zkool token file for this account (required in hot custody; mint it with scripts/zkool-token.ts)");
    // The public key Zkool was started with (--jwt-public-key-file; not secret): the token's signature is checked at
    // boot as Zkool checks it, so a token minted with another key fails here, not at the first payment (slice S3c).
    const publicKeyFile = field("ZKOOL_PUBLIC_KEY_FILE", absPath, "must be the absolute path of the EC P-256 public key Zkool was started with (--jwt-public-key-file; required in hot custody)");
    // Zkool speaks plain HTTP, so its token crosses the wire readable: a non-loopback endpoint needs the explicit
    // opt-in (ZkoolClient enforces the same rule; checking here puts it in the one startup report).
    if (url !== undefined && allowRemote === false && !LOOPBACK_HOSTS.has(new URL(url).hostname)) {
      problems.push({ variable: `${P}ZKOOL_URL`, message: "is not a loopback address; set ZECEIPT_ZKOOL_ALLOW_REMOTE=true to allow a remote Zkool deliberately" });
    } else if (url !== undefined && account !== undefined && allowRemote !== undefined && tokenFile !== undefined && publicKeyFile !== undefined) custody = { mode: "hot", zkool: { url, account, allowRemote, tokenFile, publicKeyFile } };
  } else if (mode === "external") {
    // REQ-CON-17: with an external signer the app holds a viewing key only; any hot-wallet endpoint is a misconfiguration.
    for (const k of ["ZKOOL_URL", "ZKOOL_ACCOUNT", "ZKOOL_ALLOW_REMOTE", "ZKOOL_TOKEN_FILE", "ZKOOL_PUBLIC_KEY_FILE"]) {
      if (get(k) !== undefined) problems.push({ variable: P + k, message: "must not be set in external custody (no hot wallet)" });
    }
    custody = { mode: "external" };
  }

  const dbPath = field("DB_PATH", absPath, "must be an absolute file path (not :memory: or a URL)");
  const orgId = field("ORG_ID", z.string().regex(/^[a-z0-9-]{1,64}$/), "must be 1–64 characters of a-z, 0-9 and -");
  const network = field("NETWORK", z.enum(["main", "test", "regtest"]), "must be main, test or regtest");
  const confirmations = field("CONFIRMATIONS", intIn(1, 100), "must be an integer from 1 to 100", { fallback: 3 });
  // BTCPay's automated payout processors run between 1 minute and 1 day apart (R86); regtest blocks are seconds apart,
  // so the lower bound here is 1 second, and 0 turns the worker off.
  const autoReceiptsSeconds = field("AUTO_RECEIPTS_SECONDS", intIn(0, 86_400), "must be an integer from 0 (off) to 86400 seconds", { fallback: 60 });
  const wrapKeys = parseWrapKeys(get("WRAP_KEYS"), problems);
  const lightwalletdUrl = field("LIGHTWALLETD_URL", httpUrl, "must be an http(s) URL without credentials of the lightwalletd/Zaino endpoint");
  const bin = field("BIN", absPath, "must be the absolute path of the zeceipt binary");
  const ufvkFile = field("UFVK_FILE", absPath, "must be the absolute path of the issuer's UFVK file");
  const keyFile = field("ISSUER_KEY_FILE", absPath, "must be the absolute path of the issuer signing key file");
  const keyId = field("ISSUER_KEY_ID", z.string().refine(isIssuerKeyId), "must be 1–64 characters of A-Z, a-z, 0-9, ., _ and -, optionally followed by @<domain> (an ASCII lowercase domain whose well-known file binds the key, spec §7)");
  const rateUrl = field("RATE_URL", rateUrlSchema, "must be the https URL of a Kraken-format ZEC/USD ticker (http only on a loopback host), without credentials or fragment", { fallback: KRAKEN_TICKER_URL });
  const rateMaxDriftBps = field("RATE_MAX_DRIFT_BPS", intIn(1, 2000), "must be an integer number of basis points from 1 to 2000 (300 = 3%)", { fallback: DEFAULT_MAX_DRIFT_BPS });
  const receiptHost = field("RECEIPT_HOST", receiptHostUrl, "must be the https URL of the site you control that serves the public receipt page (http only on a loopback host), without credentials, query or fragment");

  if (problems.length) throw new ConfigError(problems);
  const config: ConsoleConfig = {
    custody: custody!,
    dbPath: dbPath!,
    orgId: orgId!,
    network: network!,
    confirmations: confirmations!,
    autoReceiptsSeconds: autoReceiptsSeconds!,
    wrapKeys: wrapKeys!,
    lightwalletdUrl: lightwalletdUrl!,
    issuer: { bin: bin!, ufvkFile: ufvkFile!, keyFile: keyFile!, keyId: keyId! },
    receiptHost: receiptHost!,
    rateUrl: rateUrl!,
    rateMaxDriftBps: rateMaxDriftBps!,
  };
  return deepFreeze(config);
}

/**
 * `kid:base64[,kid:base64…]`; each key 32 bytes; kids unique. Messages name entries by position only — never
 * a key id or any other part of the value (a key written in the id's place would otherwise be echoed).
 */
function parseWrapKeys(raw: string | undefined, problems: ConfigProblem[]): ConsoleConfig["wrapKeys"] | undefined {
  const variable = `${P}WRAP_KEYS`;
  if (raw === undefined) {
    problems.push({ variable, message: "is required (kid:base64 of 32 random bytes, comma-separated; the last one seals)" });
    return undefined;
  }
  const keys: ConsoleConfig["wrapKeys"] = [];
  const parts = raw.split(",");
  for (const [i, part] of parts.entries()) {
    const at = `entry ${i + 1} of ${parts.length}`;
    const sep = part.indexOf(":");
    const kid = sep > 0 ? part.slice(0, sep).trim() : "";
    const b64 = sep > 0 ? part.slice(sep + 1).trim() : "";
    // Ids are at most 32 characters, so a base64 key (≥ 43) put in the id's place is refused, never shown.
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) {
      problems.push({ variable, message: `${at}: needs a key id of 1–32 characters of A-Z, a-z, 0-9, _ and - before ":"` });
      continue;
    }
    const std = /^[A-Za-z0-9+/]*={0,2}$/.test(b64) ? b64 : undefined;
    const bytes = std !== undefined ? Buffer.from(std, "base64") : undefined;
    if (!bytes || bytes.length !== 32 || bytes.toString("base64").replace(/=+$/, "") !== std!.replace(/=+$/, "")) {
      bytes?.fill(0);
      problems.push({ variable, message: `${at}: the key must be base64 of exactly 32 bytes` });
      continue;
    }
    if (keys.some((k) => k.kid === kid)) {
      bytes.fill(0);
      problems.push({ variable, message: `${at}: its key id repeats an earlier entry's` });
      continue;
    }
    keys.push({ kid, key: new SecretBytes(bytes) });
    // Best-effort hygiene only: the raw variable still sits in process.env (the app may delete it after
    // loading), and reveal() copies and the Keyring's buffers are not zeroed. Within one trusted process
    // this is not a boundary; the guarantees are the redaction ones (SecretBytes, #private fields).
    bytes.fill(0);
  }
  return keys.length === parts.length ? keys : undefined;
}

/**
 * Hot custody: read the Zkool token file and check its scope (slice S3; `readZkoolToken`). A problem is a ConfigError
 * naming the variable, with our message and never the token. Undefined in external custody.
 */
export function loadZkoolToken(c: ConsoleConfig, now = new Date()): { token: string; expiresAt: Date } | undefined {
  if (c.custody.mode !== "hot") return undefined;
  let publicKeyPem: string;
  try {
    publicKeyPem = readZkoolPublicKey(c.custody.zkool.publicKeyFile);
  } catch (e) {
    if (e instanceof ZkoolTokenError) throw new ConfigError([{ variable: `${P}ZKOOL_PUBLIC_KEY_FILE`, message: e.message }]);
    throw e;
  }
  try {
    const read = readZkoolToken(c.custody.zkool.tokenFile, c.custody.zkool.account, now);
    if (!verifyZkoolToken(read.token, publicKeyPem, now)) {
      throw new ZkoolTokenError(`holds a token not signed by the key in ${P}ZKOOL_PUBLIC_KEY_FILE (a token minted for another Zkool, or before its key changed?)`);
    }
    return read;
  } catch (e) {
    if (e instanceof ZkoolTokenError) throw new ConfigError([{ variable: `${P}ZKOOL_TOKEN_FILE`, message: e.message }]);
    throw e;
  }
}

/** Safe to log: no key material, no secrets; file paths and endpoints are not secret. */
export function configSummary(c: ConsoleConfig): Record<string, unknown> {
  return {
    custody: c.custody.mode === "hot" ? { mode: "hot", zkoolUrl: c.custody.zkool.url, account: c.custody.zkool.account, allowRemote: c.custody.zkool.allowRemote, tokenFile: c.custody.zkool.tokenFile, publicKeyFile: c.custody.zkool.publicKeyFile } : { mode: "external" },
    dbPath: c.dbPath,
    orgId: c.orgId,
    network: c.network,
    confirmations: c.confirmations,
    autoReceiptsSeconds: c.autoReceiptsSeconds,
    wrapKeyIds: c.wrapKeys.map((k) => k.kid),
    sealingKeyId: c.wrapKeys[c.wrapKeys.length - 1]?.kid,
    lightwalletdUrl: c.lightwalletdUrl,
    issuer: { ...c.issuer },
    receiptHost: c.receiptHost,
    rateUrl: c.rateUrl,
    rateMaxDriftBps: c.rateMaxDriftBps,
  };
}

/**
 * Remove the wrap keys' variable from the environment once the Keyring holds them (boot, slice C2), so
 * later code in this process (routes, child processes that inherit `process.env`) never sees them.
 * Best-effort like the zeroing above: it narrows exposure, it is not a boundary.
 */
export function scrubSecretEnv(env: Record<string, string | undefined> = process.env): void {
  delete env[`${P}WRAP_KEYS`];
}

/** The Keyring for this deployment (the only consumer of the key bytes). */
export function keyringFromConfig(c: ConsoleConfig): Keyring {
  return new Keyring(c.wrapKeys);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !(o instanceof SecretBytes)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
