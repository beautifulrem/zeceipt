// Worker for store-race.test.ts: one SQLite connection per worker thread. Each message carries a shared
// gate; the worker checks in, blocks until the main thread opens the gate for everyone at once, then runs
// one store operation and reports the result.
import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { openDb, SqliteIdempotencyStore } from "../../lib/index.ts";
import { base } from "./store-contract.ts";

const db = openDb({ path: workerData.path });
const store = new SqliteIdempotencyStore(db, { orgId: "org-race" });
const me: number = workerData.id;

parentPort!.on("message", async (m: { op: "create" | "cas" | "claim" | "close"; nonce: string; gate: SharedArrayBuffer }) => {
  if (m.op === "close") {
    db.$client.close();
    parentPort!.close();
    return;
  }
  const gate = new Int32Array(m.gate);
  Atomics.add(gate, 0, 1);
  Atomics.notify(gate, 0);
  Atomics.wait(gate, 1, 0); // released together
  let result: unknown;
  try {
    if (m.op === "create") result = (await store.createIntent(base(m.nonce, { batchId: `w${me}` }))).created;
    else if (m.op === "cas") result = await store.update({ ...base(m.nonce), state: "broadcast", txid: createHash("sha256").update(`${m.nonce}/${me}`).digest("hex") }, { attempts: 1, states: ["submitting"] });
    else result = await store.claimAttempt(m.nonce, 2, 60_000);
  } catch (e) {
    result = { error: (e as Error).message };
  }
  parentPort!.postMessage({ id: me, result });
});
