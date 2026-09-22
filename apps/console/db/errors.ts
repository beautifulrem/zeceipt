// Shared mapping of SQLite errors for synchronous better-sqlite3 calls.

import { StoreBusyError } from "../lib/execution/idempotency.ts";

/**
 * Run `fn` synchronously; SQLITE_BUSY (another connection holds the write lock past the busy timeout) →
 * typed, retryable `StoreBusyError`. SQLITE_LOCKED is not mapped: within one connection it signals a bug.
 */
export function runSync<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) {
      const code = (c as { code?: unknown }).code;
      if (typeof code === "string" && /^SQLITE_BUSY/.test(code)) return Promise.reject(new StoreBusyError(`database is locked (${code}); nothing was changed`));
    }
    return Promise.reject(e);
  }
}
