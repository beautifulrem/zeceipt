// Per-nonce submission records. Implementations: `SqliteIdempotencyStore` (the console's database,
// `sqlite-store.ts`), `FileIdempotencyStore` (the regtest proof and tools), `MemoryIdempotencyStore`
// (tests). All three pass one contract suite (`test/helpers/store-contract.ts`).
//
// Invariant: an intent record is created *exclusively* (exactly one creator wins, across processes)
// before the payment call. A record that exists therefore means "a payment may have been sent".

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { zatToDecimal } from "./money.ts";
import { ExecutionError, type Batch } from "./types.ts";

export type SubmissionState = "submitting" | "broadcast" | "failed_retryable" | "unknown_outcome";

export interface SubmissionRecord {
  nonce: string;
  batchId: string;
  batchDigest: string;
  state: SubmissionState;
  txid?: string;
  /** Chain tip when the intent was created; lower bound for reconciliation. */
  intentHeight?: number;
  /**
   * Upper bound on the expiry height of any transaction the latest attempt may have broadcast: a chain
   * tip observed after that attempt + the backend's expiry delta. Once the tip is above it and no
   * matching transaction was mined, that attempt can never be mined.
   */
  expiresBy?: number;
  createdAt: string;
  broadcastAt?: string;
  error?: string;
  attempts: number;
}

export interface IdempotencyStore {
  /** Create the record if absent. Returns `{created: true}` for exactly one caller per nonce. */
  createIntent(rec: SubmissionRecord): Promise<{ created: true } | { created: false; existing: SubmissionRecord }>;
  get(nonce: string): Promise<SubmissionRecord | undefined>;
  /**
   * Compare-and-set: replace the record only if it is still at attempt `expect.attempts` in one of
   * `expect.states`. Returns false (and writes nothing) otherwise, so a slow writer can never overwrite
   * a newer attempt. SQLite: `UPDATE … WHERE org_id = ? AND nonce = ? AND attempts = ? AND state IN (…)`.
   */
  update(next: SubmissionRecord, expect: Expect): Promise<boolean>;
  /** The nonce record a txid was recorded under, and the attempt that recorded it (index entries are never removed). */
  findByTxid(txid: string): Promise<TxidEntry | undefined>;
  /**
   * Exclusively claim retry attempt number `attempt` for `nonce` (true for exactly one caller). A claim
   * older than `reclaimAfterMs` whose record never moved to that attempt belongs to a claimer that died
   * (or failed) before its write — and therefore never paid, since paying needs that write — so it may be
   * claimed again. Claims are generations (`attempt`, `attempt.1`, …), each created exclusively: exactly
   * one caller wins each re-claim, with no time-based deletion. The compare-and-set write that follows
   * a claim still decides, so even an old claimer that wakes up late cannot move the record.
   */
  claimAttempt(nonce: string, attempt: number, reclaimAfterMs: number): Promise<boolean>;
  // Within one org, recording a txid already indexed under another nonce moves the index entry to the newer
  // record in every store; per-org unique memos make that impossible in practice (one txid pays one batch).
  // A record's identity (org, nonce, batchId, batchDigest) never changes after `createIntent`; the backend
  // always writes back the stored identity, and the SQLite schema refuses any change (trigger).
  // Preconditions shared by all stores: `claimAttempt` is only called for a nonce whose record exists
  // (the SQLite store's foreign key rejects anything else), and records are well-formed (64-hex digest
  // and txid; the SQLite schema's CHECKs reject malformed ones, the memory store does not check).
}

export interface TxidEntry {
  record: SubmissionRecord;
  /** Attempt that recorded this txid (undefined for index entries written before attempts were indexed). */
  attempt?: number;
}

/** The store could not complete an operation in time (lock contention); nothing was changed. */
export class StoreBusyError extends ExecutionError {
  constructor(detail: string) {
    super("store_busy", detail);
  }
}

export interface Expect {
  attempts: number;
  states: SubmissionState[];
}

function matches(cur: SubmissionRecord | undefined, expect: Expect): boolean {
  return cur !== undefined && cur.attempts === expect.attempts && expect.states.includes(cur.state);
}

/** Canonical digest of what a batch pays: network and every (payable, address, amount, memo) in order. */
export function batchDigest(batch: Batch): string {
  const canonical = JSON.stringify({
    network: batch.network,
    items: batch.items.map((i) => [i.payableId, i.address, zatToDecimal(i.zat), i.memo]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function key(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, SubmissionRecord>();
  private readonly clock: () => number;
  constructor(opts: { clock?: () => number } = {}) {
    this.clock = opts.clock ?? Date.now;
  }
  async createIntent(rec: SubmissionRecord) {
    const existing = this.records.get(rec.nonce);
    if (existing) return { created: false as const, existing: structuredClone(existing) };
    this.records.set(rec.nonce, structuredClone(rec));
    return { created: true as const };
  }
  async get(nonce: string) {
    const r = this.records.get(nonce);
    return r && structuredClone(r);
  }
  private readonly byTxid = new Map<string, { nonce: string; attempt: number }>(); // never forgets a txid
  async update(next: SubmissionRecord, expect: Expect) {
    if (!matches(this.records.get(next.nonce), expect)) return false;
    this.records.set(next.nonce, structuredClone(next));
    if (next.txid) this.byTxid.set(next.txid, { nonce: next.nonce, attempt: next.attempts });
    return true;
  }
  async findByTxid(txid: string) {
    const e = this.byTxid.get(txid);
    const record = e && (await this.get(e.nonce));
    return record && { record, attempt: e.attempt };
  }
  private readonly claims = new Map<string, number>(); // `${nonce}#${attempt}#${gen}` → claimed at
  async claimAttempt(nonce: string, attempt: number, reclaimAfterMs: number) {
    for (let gen = 0; ; gen++) {
      const k = `${nonce}#${attempt}#${gen}`;
      const at = this.claims.get(k);
      if (at === undefined) {
        this.claims.set(k, this.clock());
        return true;
      }
      if (this.clock() - at <= reclaimAfterMs) return false;
    }
  }
}

/**
 * One JSON file per nonce under `dir`. `createIntent` uses O_EXCL (`wx`), so two processes racing on
 * the same nonce cannot both proceed. Updates are write-temp-then-rename (atomic on POSIX); file contents
 * and the directory entry are fsynced so a record survives a power loss once the call returns. A small
 * `txid → nonce, attempt` index file makes `findByTxid` O(1).
 */
export class FileIdempotencyStore implements IdempotencyStore {
  private readonly dir: string;
  private readonly staleLockMs: number;
  private readonly lockWaitMs: number;
  constructor(dir: string, opts: { staleLockMs?: number; lockWaitMs?: number } = {}) {
    this.dir = dir;
    this.staleLockMs = opts.staleLockMs ?? 30_000;
    // Must exceed staleLockMs so a waiter always outlives a dead writer's lock.
    this.lockWaitMs = Math.max(opts.lockWaitMs ?? this.staleLockMs + 5_000, this.staleLockMs + 50);
  }

  private path(nonce: string) {
    return join(this.dir, `${key(nonce)}.json`);
  }

  private async writeAtomic(path: string, body: string) {
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const fh = await open(tmp, "w", 0o600);
    try {
      await fh.writeFile(body);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
    await this.syncDir();
  }

  /** Persist directory entries (a create or rename is durable only once its directory is synced). */
  private async syncDir() {
    const dh = await open(this.dir, "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  }

  async createIntent(rec: SubmissionRecord) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const fh = await open(this.path(rec.nonce), "wx", 0o600);
      try {
        await fh.writeFile(JSON.stringify(rec, null, 2));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await this.syncDir();
      return { created: true as const };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // The creator may still be writing; retry the read briefly.
      for (let i = 0; i < 20; i++) {
        const existing = await this.get(rec.nonce);
        if (existing) return { created: false as const, existing };
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`nonce record ${this.path(rec.nonce)} exists but is unreadable`);
    }
  }

  async get(nonce: string) {
    try {
      const txt = await readFile(this.path(nonce), "utf8");
      return txt ? (JSON.parse(txt) as SubmissionRecord) : undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) return undefined;
      throw e;
    }
  }

  async update(next: SubmissionRecord, expect: Expect) {
    return this.withLock(next.nonce, async (stillHeld) => {
      if (!matches(await this.get(next.nonce), expect)) return false;
      // Fence: if this process was suspended past `staleLockMs` its lock may have been broken and taken
      // by another writer; then it must not write (the lease assumption, design 3.3.5.4.8.2 / RSK-21).
      await stillHeld();
      // Index first: a txid that is findable but not yet in the record is harmless (the entry carries its
      // attempt, so `status` can tell an interrupted write from a superseded attempt); the reverse would hide it.
      if (next.txid) await this.writeAtomic(join(this.dir, `${next.txid}.txid`), `${next.nonce}\n${next.attempts}`);
      await stillHeld();
      await this.writeAtomic(this.path(next.nonce), JSON.stringify(next, null, 2));
      return true;
    });
  }

  /**
   * Per-nonce mutex across processes: an O_EXCL lock file (an update holds it for milliseconds). It is a
   * *lease*: a lock older than `staleLockMs` is presumed to belong to a writer that died mid-update and is
   * broken — but only under a second exclusive "break" lock and after re-checking that the lock file is
   * still the stale one (same inode and mtime), so two waiters can never both break it or break a fresh
   * lock. A holder that is alive but suspended longer than `staleLockMs` (SIGSTOP, sleep, a hung disk)
   * loses the lease; `fn` gets `stillHeld()`, which throws `StoreBusyError` once the lock file is no
   * longer the one this holder created, and `update` calls it before each write. On exit the lock is
   * removed only if it is still this holder's (same inode and mtime). The remaining window is a
   * suspension between the last check and the rename itself (RSK-21). A break lock is
   * itself held for microseconds; one older than `staleLockMs` is removed. Waits up to `lockWaitMs`
   * (default `staleLockMs + 5 s`, always longer than it takes a dead writer's lock to go stale), then
   * throws `StoreBusyError` (a lock that keeps being renewed by live writers).
   */
  private async withLock<T>(nonce: string, fn: (stillHeld: () => Promise<void>) => Promise<T>, staleLockMs = this.staleLockMs): Promise<T> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = join(this.dir, `${key(nonce)}.lock`);
    const deadline = Date.now() + this.lockWaitMs;
    let mine: { ino: number; mtimeMs: number } | undefined;
    for (;;) {
      try {
        const fh = await open(lock, "wx", 0o600);
        const st = await fh.stat();
        await fh.close();
        mine = { ino: st.ino, mtimeMs: st.mtimeMs };
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const st = await stat(lock).catch(() => undefined);
        if (st && Date.now() - st.mtimeMs > staleLockMs) await this.breakStale(lock, st.ino, st.mtimeMs, staleLockMs);
        else if (Date.now() > deadline) throw new StoreBusyError(`nonce lock ${lock} is held; nothing was changed`);
        else await new Promise((r) => setTimeout(r, 5));
      }
    }
    const held = mine;
    const stillHeld = async () => {
      const st = await stat(lock).catch(() => undefined);
      if (!st || st.ino !== held.ino || st.mtimeMs !== held.mtimeMs || Date.now() - st.mtimeMs > staleLockMs) {
        throw new StoreBusyError(`lost the lease on ${lock} (held longer than ${staleLockMs} ms); nothing more was written`);
      }
    };
    try {
      return await fn(stillHeld);
    } finally {
      // Never delete a lock that another writer now holds: unlink only if the file is still the one we created.
      const st = await stat(lock).catch(() => undefined);
      if (st && st.ino === held.ino && st.mtimeMs === held.mtimeMs) await unlink(lock).catch(() => {});
    }
  }

  private async breakStale(lock: string, ino: number, mtimeMs: number, staleLockMs: number) {
    const brk = `${lock}.break`;
    try {
      await (await open(brk, "wx", 0o600)).close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const b = await stat(brk).catch(() => undefined);
      if (b && Date.now() - b.mtimeMs > staleLockMs) await unlink(brk).catch(() => {});
      return; // someone else is breaking it; retry the lock
    }
    try {
      const again = await stat(lock).catch(() => undefined);
      if (again && again.ino === ino && again.mtimeMs === mtimeMs) await unlink(lock).catch(() => {});
    } finally {
      await unlink(brk).catch(() => {});
    }
  }

  async claimAttempt(nonce: string, attempt: number, reclaimAfterMs: number) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (let gen = 0; ; gen++) {
      const f = join(this.dir, `${key(nonce)}.attempt-${attempt}${gen ? `.${gen}` : ""}`);
      try {
        await (await open(f, "wx", 0o600)).close();
        await this.syncDir();
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const st = await stat(f);
        if (Date.now() - st.mtimeMs <= reclaimAfterMs) return false; // a live claim: someone else is on it
      }
    }
  }

  async findByTxid(txid: string) {
    if (!/^[0-9a-f]{64}$/.test(txid)) return undefined;
    let body: string;
    try {
      body = await readFile(join(this.dir, `${txid}.txid`), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    const [nonce, attempt] = body.split("\n");
    const record = await this.get(nonce);
    return record && { record, attempt: attempt ? Number(attempt) : undefined };
  }
}
