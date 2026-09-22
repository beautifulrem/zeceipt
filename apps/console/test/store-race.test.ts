// Real concurrency for the SQLite store: better-sqlite3 is synchronous, so the in-process "concurrent"
// cases of the shared contract run one after another. Here several worker threads, each with its own
// connection to one database file, are released at the same instant by a shared-memory gate, for several
// rounds of createIntent, compare-and-set and claimAttempt on the same nonce.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { migrateDb, openDb } from "../lib/index.ts";

const WORKERS = 6;
const ROUNDS = 15;
let dir: string;
let path: string;
let workers: Worker[] = [];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "zeceipt-race-"));
  path = join(dir, "console.db");
  const db = openDb({ path });
  migrateDb(db);
  db.$client.close();
  workers = [...Array(WORKERS)].map((_, id) => new Worker(new URL("./helpers/race-worker.ts", import.meta.url), { workerData: { path, id } }));
});
after(async () => {
  for (const w of workers) w.postMessage({ op: "close" });
  await Promise.all(workers.map((w) => new Promise((r) => w.once("exit", r))));
  await rm(dir, { recursive: true, force: true });
});

/** Send `op` to every worker, release them together, and collect `{id, result}` from each. */
async function race(op: "create" | "cas" | "claim", nonce: string): Promise<unknown[]> {
  const gate = new SharedArrayBuffer(8);
  const g = new Int32Array(gate);
  const replies = workers.map((w) => new Promise<{ id: number; result: unknown }>((r) => w.once("message", r)));
  for (const w of workers) w.postMessage({ op, nonce, gate });
  // Block (briefly) instead of Atomics.waitAsync: a waitAsync woken from another thread sometimes never
  // resolved here (observed ~1 hang in 10 runs, all workers checked in); workers do not need this thread's
  // event loop to check in, so a synchronous wait is safe.
  const deadline = Date.now() + 10_000;
  while (Atomics.load(g, 0) < WORKERS) {
    if (Date.now() > deadline) throw new Error(`only ${Atomics.load(g, 0)} of ${WORKERS} workers checked in`);
    Atomics.wait(g, 0, Atomics.load(g, 0), 50);
  }
  Atomics.store(g, 1, 1);
  Atomics.notify(g, 1);
  return (await Promise.all(replies)).map((x) => x.result);
}

test(`${WORKERS} connections × ${ROUNDS} rounds: exactly one createIntent, one CAS and one claim winner per round; one index row`, async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const nonce = `race-${round}`;
    const created = await race("create", nonce);
    assert.deepEqual(created.filter((x) => x === true).length, 1, `round ${round} create: ${JSON.stringify(created)}`);
    assert.ok(created.every((x) => typeof x === "boolean"), `round ${round} create errors: ${JSON.stringify(created)}`);
    const cas = await race("cas", nonce);
    assert.equal(cas.filter((x) => x === true).length, 1, `round ${round} cas: ${JSON.stringify(cas)}`);
    assert.ok(cas.every((x) => typeof x === "boolean"), `round ${round} cas errors: ${JSON.stringify(cas)}`);
    const claims = await race("claim", nonce);
    assert.equal(claims.filter((x) => x === true).length, 1, `round ${round} claim: ${JSON.stringify(claims)}`);
  }
  const db = openDb({ path });
  try {
    const perNonce = db.$client.prepare("SELECT nonce, count(*) AS n FROM submission_txids GROUP BY nonce").all() as { nonce: string; n: number }[];
    assert.equal(perNonce.length, ROUNDS);
    assert.ok(perNonce.every((r) => r.n === 1), JSON.stringify(perNonce));
    const claims = db.$client.prepare("SELECT count(*) AS n FROM submission_claims").get() as { n: number };
    assert.equal(claims.n, ROUNDS);
  } finally {
    db.$client.close();
  }
});
