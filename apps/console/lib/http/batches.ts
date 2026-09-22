// Batch routes that move no money (slice D1): create a draft, list drafts, read one. Route files under
// app/api/batches are thin wrappers around these handlers so they can be unit-tested with plain Requests.
//
// Amounts cross the wire as decimal strings of zatoshi (design 3.3.1.4.1.6): a batch total can exceed
// 2^53 and JSON.parse rounds large numbers silently. The org and network are the deployment's own
// configuration; a body that names either is refused as an unknown key (design 3.3.1.4.1.7).

import { z } from "zod";
import { BatchInvalidError, createBatch, getBatch, listBatches, type BatchRecord, type BatchSummary } from "../data/batches.ts";
import { ContextNotReadyError, serverContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { requestProblem } from "./guard.ts";
import { HttpProblem, internalError, problem } from "./problem.ts";

const ItemBody = z.strictObject({
  payableId: z.string(),
  label: z.string().optional(),
  address: z.string(),
  zat: z.string().regex(/^[0-9]{1,16}$/),
  memo: z.string(),
});
export const CreateBatchBody = z.strictObject({
  title: z.string(),
  items: z.array(ItemBody).min(1).max(50),
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function batchJson(rec: BatchRecord) {
  return {
    id: rec.id,
    network: rec.network,
    title: rec.title,
    createdAt: rec.createdAt,
    totalZat: rec.items.reduce((s, i) => s + i.zat, 0n).toString(),
    items: rec.items.map((i) => ({ idx: i.idx, payableId: i.payableId, label: i.label, address: i.address, zat: i.zat.toString(), memo: i.memo })),
  };
}

export type BatchJson = ReturnType<typeof batchJson>;

export function summaryJson(s: BatchSummary) {
  return { id: s.id, network: s.network, title: s.title, createdAt: s.createdAt, itemCount: s.itemCount, totalZat: s.totalZat.toString() };
}

export type BatchSummaryJson = ReturnType<typeof summaryJson>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/** Maps every failure to problem+json; anything unexpected becomes a fixed 500. */
async function answer(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpProblem) return e.response;
    if (e instanceof ContextNotReadyError) return problem(503, "not_ready", "the console has not finished starting");
    if (e instanceof BatchInvalidError) {
      return problem(422, "batch_invalid", "the batch was not created; fix every listed problem", {
        problems: e.problems.map((p) => ({ code: p.code, ...(p.itemIndex === undefined ? {} : { index: p.itemIndex }), detail: p.detail })),
      });
    }
    return internalError();
  }
}

/** `POST /api/batches`: 201 with the draft and its Location. */
export function handleCreate(req: Request): Promise<Response> {
  return answer(async () => {
    const refused = requestProblem(req.method, req.headers); // also applied by proxy.ts; kept here for the routes that write
    if (refused) return refused;
    const parsed = CreateBatchBody.safeParse(await readJson(req));
    if (!parsed.success) {
      // Paths and zod's own messages only; zod issues also carry the input, which is never echoed.
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      throw new HttpProblem(400, "body_invalid", "the body does not match the batch schema", { issues });
    }
    const { config, db } = serverContext();
    const rec = await createBatch(db, {
      orgId: config.orgId,
      network: config.network,
      title: parsed.data.title,
      items: parsed.data.items.map((i) => ({ payableId: i.payableId, label: i.label, address: i.address, zat: BigInt(i.zat), memo: i.memo })),
    });
    return json(201, batchJson(rec), { Location: `/api/batches/${rec.id}` });
  });
}

/** `GET /api/batches`: newest first. */
export function handleList(): Promise<Response> {
  return answer(async () => {
    const { config, db } = serverContext();
    return json(200, { batches: (await listBatches(db, config.orgId)).map(summaryJson) });
  });
}

/** `GET /api/batches/:id`: 404 for an unknown id and, without a query, for anything that is not a UUIDv7. */
export function handleGet(id: string): Promise<Response> {
  return answer(async () => {
    const { config, db } = serverContext();
    const rec = UUID_V7.test(id) ? await getBatch(db, config.orgId, id) : undefined;
    if (!rec) return problem(404, "batch_not_found", "no batch with this id");
    return json(200, batchJson(rec));
  });
}
