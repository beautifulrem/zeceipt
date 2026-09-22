// Child process used by the two-process race tests: submits one batch with one nonce against a shared
// store (`file:<dir>` or `sqlite:<db file>`) and prints the outcome as JSON.
import { FileIdempotencyStore, openDb, SqliteIdempotencyStore, ZkoolBackend, ZkoolClient, type IdempotencyStore } from "../../lib/index.ts";
const [url, storeSpec, nonce, batchJson] = process.argv.slice(2);
const batch = JSON.parse(batchJson, (k, v) => (k === "zat" ? BigInt(v) : v));
let store: IdempotencyStore;
let close = () => {};
if (storeSpec.startsWith("sqlite:")) {
  const db = openDb({ path: storeSpec.slice("sqlite:".length) });
  store = new SqliteIdempotencyStore(db, { orgId: "org-race" });
  close = () => db.$client.close();
} else {
  store = new FileIdempotencyStore(storeSpec.replace(/^file:/, ""));
}
const backend = new ZkoolBackend({ client: new ZkoolClient({ url, payTimeoutMs: 5_000 }), account: 9, store });
try {
  const r = await backend.submit(batch, nonce);
  console.log(JSON.stringify({ ok: true, ...r }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: (e as { code?: string }).code, message: (e as Error).message }));
} finally {
  close();
}
