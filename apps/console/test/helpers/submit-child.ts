// Child process used by the two-process race test: submits one batch with one nonce against a shared
// file store and prints the outcome as JSON.
import { FileIdempotencyStore, ZkoolBackend, ZkoolClient } from "../../lib/index.ts";
const [url, dir, nonce, batchJson] = process.argv.slice(2);
const batch = JSON.parse(batchJson, (k, v) => (k === "zat" ? BigInt(v) : v));
const backend = new ZkoolBackend({ client: new ZkoolClient({ url, payTimeoutMs: 5_000 }), account: 9, store: new FileIdempotencyStore(dir) });
try {
  const r = await backend.submit(batch, nonce);
  console.log(JSON.stringify({ ok: true, ...r }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: (e as { code?: string }).code, message: (e as Error).message }));
}
