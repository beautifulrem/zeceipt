// Worker for rate-quotes.test.ts: its own SQLite connection; waits at a shared gate, then appends `count` lock
// quotes to one batch as fast as it can and reports the seqs it got (or the error).
import { parentPort, workerData } from "node:worker_threads";
import { openDb, recordQuote, type RateQuote } from "../../lib/index.ts";

const db = openDb({ path: workerData.path });
const quote: RateQuote = { source: "kraken", pair: "XZECZUSD", bid: "1616.24", ask: "1616.97", last: "1616.34", rate: "1616.24", fetchedAt: "2026-09-23T03:40:00.123Z", host: "api.kraken.com" };

parentPort!.on("message", async (m: { orgId: string; batchId: string; count: number; gate: SharedArrayBuffer }) => {
  const gate = new Int32Array(m.gate);
  Atomics.add(gate, 0, 1);
  Atomics.notify(gate, 0);
  Atomics.wait(gate, 1, 0);
  const seqs: number[] = [];
  try {
    for (let i = 0; i < m.count; i++) seqs.push((await recordQuote(db, { orgId: m.orgId, batchId: m.batchId, purpose: "lock", quote })).seq);
    parentPort!.postMessage({ seqs });
  } catch (e) {
    parentPort!.postMessage({ seqs, error: (e as Error).message });
  }
});
