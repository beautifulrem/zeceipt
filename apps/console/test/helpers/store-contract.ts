// One behavioural contract for every `IdempotencyStore` (memory, file, SQLite). A store is only used by
// `ZkoolBackend` through this interface, so passing this suite is what "a correct store" means.
//
// The "N concurrent callers" cases start N calls at once within one process. For the file store they
// genuinely interleave; the memory and SQLite stores run each call to completion synchronously, so for
// them these cases check sequential semantics only. Real cross-connection races on SQLite are in
// store-race.test.ts (worker threads) and zkool-backend.test.ts (two OS processes).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IdempotencyStore, SubmissionRecord } from "../../lib/index.ts";

export interface StoreFixture {
  store: IdempotencyStore;
  /** Make every existing claim for (nonce, attempt) `ms` older (a store-specific clock or mtime shift). */
  ageClaims(nonce: string, attempt: number, ms: number): Promise<void>;
  cleanup(): Promise<void>;
}

const HEX = (c: string) => c.repeat(64);
const DIGEST = HEX("a");

export function base(nonce: string, over: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return { nonce, batchId: `batch-${nonce}`, batchDigest: DIGEST, state: "submitting", createdAt: "2026-09-23T00:00:00.000Z", attempts: 1, ...over };
}

export function storeContract(name: string, make: () => Promise<StoreFixture>) {
  const withStore = (title: string, fn: (f: StoreFixture) => Promise<void>) =>
    test(`[${name}] ${title}`, async () => {
      const f = await make();
      try {
        await fn(f);
      } finally {
        await f.cleanup();
      }
    });

  withStore("createIntent: exactly one of 8 concurrent creators wins; the others read the winner's record", async ({ store }) => {
    const results = await Promise.all([...Array(8)].map((_, i) => store.createIntent(base("n-create", { batchId: `b${i}` }))));
    const winners = results.filter((r) => r.created);
    assert.equal(winners.length, 1);
    const stored = await store.get("n-create");
    for (const r of results) if (!r.created) assert.deepEqual(r.existing, stored);
  });

  withStore("get: missing → undefined; full and minimal records round-trip exactly", async ({ store }) => {
    assert.equal(await store.get("n-missing"), undefined);
    const minimal = base("n-min");
    await store.createIntent(minimal);
    assert.deepEqual(await store.get("n-min"), minimal);
    const full = base("n-full");
    await store.createIntent(full);
    const next: SubmissionRecord = { ...full, state: "broadcast", txid: HEX("b"), intentHeight: 100, expiresBy: 150, broadcastAt: "2026-09-23T00:01:00.000Z", error: "e" };
    assert.equal(await store.update(next, { attempts: 1, states: ["submitting"] }), true);
    assert.deepEqual(await store.get("n-full"), next);
  });

  withStore("update is compare-and-set: stale attempt, wrong state, missing nonce and empty state set are rejected", async ({ store }) => {
    const rec = base("n-cas");
    await store.createIntent(rec);
    assert.equal(await store.update({ ...rec, attempts: 2 }, { attempts: 1, states: ["submitting"] }), true);
    assert.equal(await store.update({ ...rec, error: "stale" }, { attempts: 1, states: ["submitting"] }), false);
    assert.equal(await store.update({ ...rec, attempts: 2, error: "x" }, { attempts: 2, states: ["broadcast"] }), false);
    assert.equal(await store.update({ ...rec, attempts: 2, error: "x" }, { attempts: 2, states: [] }), false);
    assert.equal(await store.update(base("n-nobody"), { attempts: 1, states: ["submitting"] }), false);
    assert.deepEqual(await store.get("n-cas"), { ...rec, attempts: 2 });
  });

  withStore("update: exactly one of 8 concurrent writers with the same expectation wins", async ({ store }) => {
    const rec = base("n-race");
    await store.createIntent(rec);
    const wins = await Promise.all([...Array(8)].map((_, i) => store.update({ ...rec, state: "broadcast", txid: HEX(String(i)) }, { attempts: 1, states: ["submitting"] })));
    assert.equal(wins.filter(Boolean).length, 1);
    const winner = wins.indexOf(true);
    assert.equal((await store.get("n-race"))?.txid, HEX(String(winner)));
    // Losers' txids were never indexed.
    for (let i = 0; i < 8; i++) if (i !== winner) assert.equal(await store.findByTxid(HEX(String(i))), undefined);
  });

  withStore("findByTxid: returns the recording attempt; a superseded txid still resolves; junk → undefined", async ({ store }) => {
    const rec = base("n-idx");
    await store.createIntent(rec);
    const a1: SubmissionRecord = { ...rec, state: "broadcast", txid: HEX("c"), broadcastAt: "t1" };
    assert.equal(await store.update(a1, { attempts: 1, states: ["submitting"] }), true);
    const a2: SubmissionRecord = { ...rec, state: "submitting", attempts: 2, createdAt: "t2" };
    assert.equal(await store.update(a2, { attempts: 1, states: ["broadcast"] }), true);
    const a2done: SubmissionRecord = { ...a2, state: "broadcast", txid: HEX("d"), broadcastAt: "t3" };
    assert.equal(await store.update(a2done, { attempts: 2, states: ["submitting"] }), true);
    assert.deepEqual(await store.findByTxid(HEX("c")), { record: a2done, attempt: 1 });
    assert.deepEqual(await store.findByTxid(HEX("d")), { record: a2done, attempt: 2 });
    assert.equal(await store.findByTxid(HEX("e")), undefined);
    assert.equal(await store.findByTxid("not-a-txid"), undefined);
  });

  withStore("claimAttempt: a live claim is exclusive; attempts are independent", async ({ store }) => {
    await store.createIntent(base("n-claim"));
    assert.equal(await store.claimAttempt("n-claim", 2, 60_000), true);
    assert.equal(await store.claimAttempt("n-claim", 2, 60_000), false);
    assert.equal(await store.claimAttempt("n-claim", 3, 60_000), true);
    const racers = await Promise.all([...Array(6)].map(() => store.claimAttempt("n-claim", 4, 60_000)));
    assert.equal(racers.filter(Boolean).length, 1);
  });

  withStore("claimAttempt: a claim older than reclaimAfterMs is re-taken by exactly one caller per generation", async (f) => {
    await f.store.createIntent(base("n-reclaim"));
    assert.equal(await f.store.claimAttempt("n-reclaim", 2, 60_000), true);
    await f.ageClaims("n-reclaim", 2, 120_000);
    const takers = await Promise.all([...Array(6)].map(() => f.store.claimAttempt("n-reclaim", 2, 60_000)));
    assert.equal(takers.filter(Boolean).length, 1);
    assert.equal(await f.store.claimAttempt("n-reclaim", 2, 60_000), false, "the new generation is live");
  });

  withStore("a claimer that died before advancing the record cannot wedge the nonce", async (f) => {
    const rec = base("n-dead", { state: "failed_retryable" });
    await f.store.createIntent(rec);
    assert.equal(await f.store.claimAttempt("n-dead", 2, 60_000), true); // …and then the claimer died
    assert.equal(await f.store.claimAttempt("n-dead", 2, 60_000), false);
    await f.ageClaims("n-dead", 2, 120_000);
    assert.equal(await f.store.claimAttempt("n-dead", 2, 60_000), true);
    assert.equal(await f.store.update({ ...rec, state: "submitting", attempts: 2 }, { attempts: 1, states: ["failed_retryable"] }), true);
  });
}
