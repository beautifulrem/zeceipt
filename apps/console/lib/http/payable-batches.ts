// `POST /api/batches/from-payables` (slice H5a; design H5a.1.8): the body (400), the payables and title from a read
// (422, before a quote is spent), the quote (502 when the source fails; nothing created), then one transaction that
// converts, writes the lines and records the quote as the batch's only lock (422 again if a concurrent batch took a
// payable). Problems are mapped by `code` (E1: the library can load twice under Next.js).

import { z } from "zod";
import { BatchInvalidError } from "../data/batches.ts";
import { createBatchFromPayables, MAX_PAYABLES, payableBatchProblems } from "../data/payable-batches.ts";
import { serverContext } from "../server/context.ts";
import { batchJson } from "./batches.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";
import { lockJson, ratesProblem } from "./rates.ts";

export const CreateFromPayablesBody = z.strictObject({
  title: z.string(),
  payableIds: z.array(z.string()).min(1).max(MAX_PAYABLES),
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

interface ProblemLike { code: string; itemIndex?: number; detail: string }

/** 422 `batch_invalid` with every problem (by `code`), then the rate lock's own mapping (502, 503). */
export function payableBatchesProblem(e: unknown): Response | undefined {
  const err = e as { code?: unknown; problems?: ProblemLike[] } | null;
  if (err?.code === "batch_invalid" && Array.isArray(err.problems)) {
    return problem(422, "batch_invalid", "the batch was not created; fix every listed problem", {
      problems: err.problems.map((p) => ({ code: p.code, ...(p.itemIndex === undefined ? {} : { index: p.itemIndex }), detail: p.detail })),
    });
  }
  return ratesProblem(e);
}

export async function createFromPayablesResponse(req: Request): Promise<Response> {
  return createFromPayablesFrom(await readJson(req));
}

/** Shared by the API route and the page (H5b): the parsed body in, the API's answer out. */
export async function createFromPayablesFrom(body: unknown): Promise<Response> {
  const parsed = CreateFromPayablesBody.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new HttpProblem(400, "body_invalid", "the body does not match the schema for a batch from payables", { issues });
  }
  const { config, db, quote } = serverContext();
  const input = { orgId: config.orgId, network: config.network, title: parsed.data.title, payableIds: parsed.data.payableIds };
  const problems = await payableBatchProblems(db, input);
  if (problems.length) throw new BatchInvalidError(problems);
  const q = await quote();
  const { batch, lock } = await createBatchFromPayables(db, { ...input, quote: q });
  return json(201, batchJson(batch, lockJson(lock)), { Location: `/api/batches/${batch.id}` });
}
