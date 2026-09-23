// The console's per-process server context: validated config, migrated database, keyring, nonce store and
// wallet backend (slices C2, D2; boot state vs built context: slice E1).
//
// Booted once from `instrumentation.ts` `register()` before Next.js serves requests, and read by route
// handlers through `serverContext()`. It lives on `globalThis` under a registered symbol: measured on
// Next.js 16.3.6, `register()` and route handlers share `globalThis` in one process, while module-level
// state is not guaranteed to be shared between Next's separate bundles (design 3.3.1.1.6.4).
//
// Nothing boots lazily inside a request: before boot, `serverContext()` throws (fail closed).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, keyringFromConfig, loadConfig, scrubSecretEnv, type ConsoleConfig } from "../config/env.ts";
import type { Keyring } from "../crypto/seal.ts";
import { ExecutionError } from "../execution/types.ts";
import { SqliteIdempotencyStore } from "../execution/sqlite-store.ts";
import { ZkoolBackend } from "../execution/zkool-backend.ts";
import { ZkoolClient } from "../execution/zkool-client.ts";
import { migrateDb, openDb, type ConsoleDb } from "../../db/client.ts";

export interface ServerContext {
  readonly config: ConsoleConfig;
  readonly db: ConsoleDb;
  readonly keyring: Keyring;
  /** The execution nonce store (SQLite, scoped to the org); the backend and status readers share it. */
  readonly store: SqliteIdempotencyStore;
  /** The Zkool backend in hot custody; undefined in external custody, where this console never pays (slice D2). */
  readonly backend?: ZkoolBackend;
}

/**
 * What boot publishes on `globalThis`: plain state only. Measured on Next.js 16.3.6 (slice E1): the
 * library is loaded twice, once in the instrumentation bundle and once in the app bundle, so a class
 * instance built at boot throws errors of the boot copy's classes, which `instanceof` in route handlers and
 * pages never matches (a ZkoolTransportError from a boot-built backend failed `instanceof
 * ZkoolTransportError` in a page). Objects with classes (keyring, store, backend) are therefore built by
 * `serverContext()` in the bundle that uses them, once per bundle.
 */
export interface BootState {
  readonly config: ConsoleConfig;
  readonly db: ConsoleDb;
}

export interface BootOptions {
  /** The Drizzle migrations folder; the app passes `<cwd>/db/migrations` (bundles have no `import.meta.dirname`). */
  migrationsFolder: string;
}

/** The `globalThis` key of the boot state (a registered symbol, so it survives dev module reloads). */
export const SERVER_CONTEXT_KEY: unique symbol = Symbol.for("zeceipt.console.context") as never;

type Slot = { [SERVER_CONTEXT_KEY]?: BootState };

export class ContextNotReadyError extends ExecutionError {
  constructor() {
    super("context_not_ready", "the console has not booted (instrumentation register() did not complete)");
  }
}

/**
 * Boot once per process: load and validate the configuration, check the keyring builds, open and migrate
 * the database, remove the wrap keys from `env`, then publish the boot state. Idempotent: a second call
 * returns the context of the published state (Next.js may call `register()` again after a dev reload).
 * The migrations journal must exist before the database is opened (a clear error names the path).
 * On any failure nothing is published, the database handle (if opened) is closed, and the error is
 * rethrown; the caller exits the process (design 3.3.1.1.6.2).
 */
export function bootServerContext(env: Record<string, string | undefined>, opts: BootOptions): ServerContext {
  const slot = globalThis as Slot;
  if (slot[SERVER_CONTEXT_KEY]) return serverContext();

  const config = loadConfig(env);
  // Checked before anything is opened, so a wrong working directory is named instead of surfacing as
  // Drizzle's bare "Can't find meta/_journal.json file" (review C2 round 1).
  const journal = join(opts.migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journal)) {
    throw new Error(`migrations journal not found at ${journal}; start the console from apps/console (the folder is <cwd>/db/migrations)`);
  }
  keyringFromConfig(config); // fail at startup, not on the first receipt, if the keys cannot form a keyring
  const db = openDb({ path: config.dbPath });
  try {
    migrateDb(db, opts.migrationsFolder);
  } catch (e) {
    db.$client.close();
    throw e;
  }
  scrubSecretEnv(env);
  slot[SERVER_CONTEXT_KEY] = Object.freeze({ config, db });
  return serverContext();
}

/** One built context per boot state, per bundle (this module-level map is itself per bundle). */
const built = new WeakMap<BootState, ServerContext>();

/**
 * The context for the calling bundle; throws `ContextNotReadyError` before boot. The keyring, store and
 * backend are built here on first use, so their classes are this bundle's (see `BootState`). No network
 * call: a wallet outage must not stop the console from starting or answering (slice C2's health rule).
 */
export function serverContext(): ServerContext {
  const boot = (globalThis as Slot)[SERVER_CONTEXT_KEY];
  if (!boot) throw new ContextNotReadyError();
  let ctx = built.get(boot);
  if (!ctx) {
    const { config, db } = boot;
    const store = new SqliteIdempotencyStore(db, { orgId: config.orgId });
    const custody = config.custody;
    const backend =
      custody.mode === "hot"
        ? new ZkoolBackend({ client: new ZkoolClient({ url: custody.zkool.url, allowRemote: custody.zkool.allowRemote }), account: custody.zkool.account, store })
        : undefined;
    ctx = Object.freeze({ config, db, keyring: keyringFromConfig(config), store, backend });
    built.set(boot, ctx);
  }
  return ctx;
}

/**
 * The stderr lines for a failed boot, one per problem. Never contains a secret: `ConfigError` problems
 * are a variable name plus our own fixed message that never echoes a value (slice C1); other errors come
 * from opening or migrating the database and may name the database path, which is not secret (it is in
 * `configSummary` too). No wrap key can reach them: the keyring is built before the database is opened.
 */
export function bootFailureLines(err: unknown): string[] {
  if (err instanceof ConfigError) {
    return err.problems.map((p) => `startup refused: ${p.variable}: ${p.message}`);
  }
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  return [`startup refused: ${name}: ${message.replace(/\s+/g, " ").trim()}`];
}
