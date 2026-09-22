// Per-nonce submission records. The console's `batches.nonce` column (libSQL) will implement the same
// interface; the file store is what the library ships with and what the tests and the regtest proof use.
//
// Invariant: an intent record is created *exclusively* (exactly one creator wins, across processes)
// before the payment call. A record that exists therefore means "a payment may have been sent".

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { zatToDecimal } from "./money.ts";
import type { Batch } from "./types.ts";

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
   * a newer attempt. libSQL: `UPDATE … WHERE nonce = ? AND attempts = ? AND state IN (…)`.
   */
  update(next: SubmissionRecord, expect: Expect): Promise<boolean>;
  findByTxid(txid: string): Promise<SubmissionRecord | undefined>;
  /** Exclusively claim retry attempt number `attempt` for `nonce` (true for exactly one caller). */
  claimAttempt(nonce: string, attempt: number): Promise<boolean>;
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
  private readonly byTxid = new Map<string, string>(); // like the file store's index: never forgets a txid
  async update(next: SubmissionRecord, expect: Expect) {
    if (!matches(this.records.get(next.nonce), expect)) return false;
    this.records.set(next.nonce, structuredClone(next));
    if (next.txid) this.byTxid.set(next.txid, next.nonce);
    return true;
  }
  async findByTxid(txid: string) {
    const nonce = this.byTxid.get(txid);
    return nonce === undefined ? undefined : this.get(nonce);
  }
  private readonly attempts = new Set<string>();
  async claimAttempt(nonce: string, attempt: number) {
    const k = `${nonce}#${attempt}`;
    if (this.attempts.has(k)) return false;
    this.attempts.add(k);
    return true;
  }
}

/**
 * One JSON file per nonce under `dir`. `createIntent` uses O_EXCL (`wx`), so two processes racing on
 * the same nonce cannot both proceed. Updates are write-temp-then-rename (atomic on POSIX); file contents
 * and the directory entry are fsynced so a record survives a power loss once the call returns. A small
 * `txid → nonce` index file makes `findByTxid` O(1).
 */
export class FileIdempotencyStore implements IdempotencyStore {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
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
    return this.withLock(next.nonce, async () => {
      if (!matches(await this.get(next.nonce), expect)) return false;
      // Index first: a txid that is findable but not yet in the record is harmless; the reverse would hide it.
      if (next.txid) await this.writeAtomic(join(this.dir, `${next.txid}.txid`), next.nonce);
      await this.writeAtomic(this.path(next.nonce), JSON.stringify(next, null, 2));
      return true;
    });
  }

  /**
   * Per-nonce mutex across processes: an O_EXCL lock file. A lock older than `staleLockMs` (a writer
   * that died mid-update; an update takes milliseconds) is broken.
   */
  private async withLock<T>(nonce: string, fn: () => Promise<T>, staleLockMs = 30_000): Promise<T> {
    const lock = join(this.dir, `${key(nonce)}.lock`);
    for (let i = 0; ; i++) {
      try {
        await (await open(lock, "wx", 0o600)).close();
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const age = await stat(lock).then((st) => Date.now() - st.mtimeMs, () => 0);
        if (age > staleLockMs) await unlink(lock).catch(() => {});
        else if (i > 2_000) throw new Error(`nonce lock ${lock} held for too long`);
        else await new Promise((r) => setTimeout(r, 5));
      }
    }
    try {
      return await fn();
    } finally {
      await unlink(lock).catch(() => {});
    }
  }

  async claimAttempt(nonce: string, attempt: number) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const fh = await open(join(this.dir, `${key(nonce)}.attempt-${attempt}`), "wx", 0o600);
      await fh.close();
      await this.syncDir();
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  }

  async findByTxid(txid: string) {
    if (!/^[0-9a-f]{64}$/.test(txid)) return undefined;
    try {
      const nonce = await readFile(join(this.dir, `${txid}.txid`), "utf8");
      return this.get(nonce);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }
}
