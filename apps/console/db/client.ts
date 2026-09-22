// Database handle for the console: SQLite via better-sqlite3 + Drizzle, and the migrator.
//
// Driver choice (design 3.3.1.3.1.1.1, research log R47): better-sqlite3, not the libSQL local client.
// libSQL's local driver leaves a statement that failed with SQLITE_BUSY un-finalized, after which every
// later write on that pooled connection reports success but never commits (reproduced; upstream
// tursodatabase/libsql-client-ts#352, open). better-sqlite3 and node:sqlite pass the same test.

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import * as schema from "./schema.ts";

export type ConsoleDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface OpenDbOptions {
  /** Path of the SQLite file, e.g. `/var/lib/zeceipt/console.db`. In-memory databases are refused. */
  path: string;
  /**
   * How long a write waits for another process's lock before failing with SQLITE_BUSY (→ `StoreBusyError`).
   * The wait is synchronous; writes hold the lock for milliseconds. Default 5000 ms.
   */
  busyTimeoutMs?: number;
}

export function openDb(opts: OpenDbOptions): ConsoleDb {
  if (!opts.path || opts.path === ":memory:" || opts.path.startsWith("file:")) {
    throw new RangeError(`console database must be a file path (got ${JSON.stringify(opts.path)})`);
  }
  const client = new Database(opts.path, { timeout: opts.busyTimeoutMs ?? 5_000 });
  client.pragma("journal_mode = WAL"); // readers never block the writer, across processes
  client.pragma("synchronous = FULL"); // the nonce table is a payment ledger: fsync every commit
  client.pragma("foreign_keys = ON");
  return drizzle(client, { schema }) as ConsoleDb;
}

export const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/**
 * Apply pending migrations (Drizzle journal in `__drizzle_migrations`; a second run is a no-op).
 * Run once at startup, before serving requests; it is not meant to race another migrator.
 */
export function migrateDb(db: ConsoleDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
