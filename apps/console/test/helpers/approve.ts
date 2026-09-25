// Approve a batch as it is now, through the real route (slice I3): every test that pays approves first, as the
// operator would, naming the total and the current lock it read.
import assert from "node:assert/strict";
import * as approveRoute from "../../app/api/batches/[id]/approve/route.ts";
import { currentLock, getBatch, serverContext } from "../../lib/index.ts";

const HOST = "127.0.0.1:3000";
const headers = { host: HOST, "content-type": "application/json", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };

/** POST /api/batches/{id}/approve with `body` (default: the batch's total and current lock). */
export async function approveRequest(id: string, body?: unknown): Promise<Response> {
  let payload = body;
  if (payload === undefined) {
    const { db, config } = serverContext();
    const rec = await getBatch(db, config.orgId, id);
    const lock = await currentLock(db, config.orgId, id);
    payload = { confirmTotalZat: (rec?.items ?? []).reduce((s, i) => s + i.zat, 0n).toString(), lockSeq: lock?.seq ?? 1 };
  }
  return approveRoute.POST(new Request(`http://${HOST}/api/batches/${id}/approve`, { method: "POST", headers, body: typeof payload === "string" ? payload : JSON.stringify(payload) }), { params: Promise.resolve({ id }) });
}

/** Approve and assert it was recorded (201) or already valid (200). */
export async function approve(id: string): Promise<void> {
  const r = await approveRequest(id);
  assert.ok(r.status === 201 || r.status === 200, `approve ${id}: ${r.status} ${await r.text()}`);
}
