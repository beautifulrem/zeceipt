// Console configuration (design `.trellis/tasks/09-23-console-config/design.md`). The ONLY module that
// reads ZECEIPT_* environment variables (Twelve-Factor config; one owner for the payload, per the
// cross-layer guide). Everything else receives the typed, frozen ConsoleConfig. Errors name the variable
// and a fixed message of ours — never the value (zod's raw issues carry the input; they are not surfaced).

import { isAbsolute } from "node:path";
import { z } from "zod";
import type { WrapKey } from "../crypto/seal.ts";
import { ExecutionError, type Network } from "../execution/types.ts";

export type CustodyConfig = { mode: "hot"; zkool: { url: string; account: number; allowRemote: boolean } } | { mode: "external" };

export interface ConsoleConfig {
  custody: CustodyConfig;
  dbPath: string;
  orgId: string;
  network: Network;
  confirmations: number;
  /** Deployment wrap keys, in order; the last one seals new values. Never logged or serialized. */
  wrapKeys: WrapKey[];
  lightwalletdUrl: string;
  issuer: { bin: string; ufvkFile: string; keyFile: string; keyId: string };
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
  "DB_PATH",
  "ORG_ID",
  "NETWORK",
  "CONFIRMATIONS",
  "WRAP_KEYS",
  "LIGHTWALLETD_URL",
  "BIN",
  "UFVK_FILE",
  "ISSUER_KEY_FILE",
  "ISSUER_KEY_ID",
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
});
const absPath = z.string().refine((s) => isAbsolute(s) && !s.startsWith("file:") && s !== ":memory:");
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
    if (url !== undefined && account !== undefined && allowRemote !== undefined) custody = { mode: "hot", zkool: { url, account, allowRemote } };
  } else if (mode === "external") {
    // REQ-CON-17: with an external signer the app holds a viewing key only; any hot-wallet endpoint is a misconfiguration.
    for (const k of ["ZKOOL_URL", "ZKOOL_ACCOUNT", "ZKOOL_ALLOW_REMOTE"]) {
      if (get(k) !== undefined) problems.push({ variable: P + k, message: "must not be set in external custody (no hot wallet)" });
    }
    custody = { mode: "external" };
  }

  const dbPath = field("DB_PATH", absPath, "must be an absolute file path (not :memory: or a URL)");
  const orgId = field("ORG_ID", z.string().regex(/^[a-z0-9-]{1,64}$/), "must be 1–64 characters of a-z, 0-9 and -");
  const network = field("NETWORK", z.enum(["main", "test", "regtest"]), "must be main, test or regtest");
  const confirmations = field("CONFIRMATIONS", intIn(1, 100), "must be an integer from 1 to 100", { fallback: 3 });
  const wrapKeys = parseWrapKeys(get("WRAP_KEYS"), problems);
  const lightwalletdUrl = field("LIGHTWALLETD_URL", httpUrl, "must be an http(s) URL without credentials of the lightwalletd/Zaino endpoint");
  const bin = field("BIN", absPath, "must be the absolute path of the zeceipt binary");
  const ufvkFile = field("UFVK_FILE", absPath, "must be the absolute path of the issuer's UFVK file");
  const keyFile = field("ISSUER_KEY_FILE", absPath, "must be the absolute path of the issuer signing key file");
  const keyId = field("ISSUER_KEY_ID", z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), "must be 1–64 characters of A-Z, a-z, 0-9, ., _ and -");

  if (problems.length) throw new ConfigError(problems);
  const config: ConsoleConfig = {
    custody: custody!,
    dbPath: dbPath!,
    orgId: orgId!,
    network: network!,
    confirmations: confirmations!,
    wrapKeys: wrapKeys!,
    lightwalletdUrl: lightwalletdUrl!,
    issuer: { bin: bin!, ufvkFile: ufvkFile!, keyFile: keyFile!, keyId: keyId! },
  };
  // Key bytes never reach JSON (logs, error reporters, API responses).
  Object.defineProperty(config, "toJSON", { enumerable: false, value: () => ({ ...config, wrapKeys: config.wrapKeys.map((k) => ({ kid: k.kid, key: "[redacted]" })) }) });
  return deepFreeze(config);
}

/** `kid:base64[,kid:base64…]`; each key 32 bytes; kids unique. Messages never contain any part of the value. */
function parseWrapKeys(raw: string | undefined, problems: ConfigProblem[]): WrapKey[] | undefined {
  const variable = `${P}WRAP_KEYS`;
  if (raw === undefined) {
    problems.push({ variable, message: "is required (kid:base64 of 32 random bytes, comma-separated; the last one seals)" });
    return undefined;
  }
  const keys: WrapKey[] = [];
  const parts = raw.split(",");
  for (const [i, part] of parts.entries()) {
    const at = `entry ${i + 1} of ${parts.length}`;
    const sep = part.indexOf(":");
    const kid = sep > 0 ? part.slice(0, sep).trim() : "";
    const b64 = sep > 0 ? part.slice(sep + 1).trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid)) {
      problems.push({ variable, message: `${at}: needs a key id of 1–64 characters of A-Z, a-z, 0-9, _ and - before ":"` });
      continue;
    }
    const std = /^[A-Za-z0-9+/]*={0,2}$/.test(b64) ? b64 : undefined;
    const bytes = std !== undefined ? Buffer.from(std, "base64") : undefined;
    if (!bytes || bytes.length !== 32 || bytes.toString("base64").replace(/=+$/, "") !== std!.replace(/=+$/, "")) {
      problems.push({ variable, message: `${at} (key id ${kid}): must be base64 of exactly 32 bytes` });
      continue;
    }
    if (keys.some((k) => k.kid === kid)) {
      problems.push({ variable, message: `${at}: duplicate key id ${kid}` });
      continue;
    }
    keys.push({ kid, key: new Uint8Array(bytes) });
  }
  return keys.length === parts.length ? keys : undefined;
}

/** Safe to log: no key material, no secrets; file paths and endpoints are not secret. */
export function configSummary(c: ConsoleConfig): Record<string, unknown> {
  return {
    custody: c.custody.mode === "hot" ? { mode: "hot", zkoolUrl: c.custody.zkool.url, account: c.custody.zkool.account, allowRemote: c.custody.zkool.allowRemote } : { mode: "external" },
    dbPath: c.dbPath,
    orgId: c.orgId,
    network: c.network,
    confirmations: c.confirmations,
    wrapKeyIds: c.wrapKeys.map((k) => k.kid),
    sealingKeyId: c.wrapKeys[c.wrapKeys.length - 1]?.kid,
    lightwalletdUrl: c.lightwalletdUrl,
    issuer: { ...c.issuer },
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !(o instanceof Uint8Array)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
