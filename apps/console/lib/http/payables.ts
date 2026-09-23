// Payable routes (slice H3; REQ-CON-3): create one, list them, read one. The org is the deployment's own: a body
// that names it is refused as an unknown key (as batches, D1, and recipients, H1). Types are 400; values are 422
// with every problem; a reference already used in the org is 409 with the payable that holds it.

import { z } from "zod";
import { createPayable, getPayable, listPayables, PAYABLE_KINDS, type PayableProblem, type PayableRecord } from "../data/payables.ts";
import { serverContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";

export const CreatePayableBody = z.strictObject({
  recipientId: z.string(),
  kind: z.enum(PAYABLE_KINDS),
  usdCents: z.number(),
  reference: z.string(),
  sourceUrl: z.string().optional(),
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export function payableJson(p: PayableRecord) {
  return { id: p.id, recipientId: p.recipientId, kind: p.kind, usdCents: p.usdCents, reference: p.reference, sourceUrl: p.sourceUrl, createdAt: p.createdAt };
}

/** Domain failures by code (the library loads twice under Next.js, slice E1). */
export function payablesProblem(e: unknown): Response | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "store_busy") return problem(503, "store_busy", "the database is busy; nothing was saved; retry shortly", {}, { "Retry-After": "1" });
  if (code === "reference_taken") {
    return problem(409, "reference_taken", "another payable of this organisation already has this reference (it becomes the memo, so it must be unique); nothing was saved", { payableId: (e as { payableId?: string }).payableId });
  }
  if (code !== "payable_invalid") return undefined;
  const problems = (e as { problems?: PayableProblem[] }).problems ?? [];
  return problem(422, "payable_invalid", "the payable was not created; fix every listed problem", { problems: problems.map((p) => ({ code: p.code, field: p.field, detail: p.detail })) });
}

/** `POST /api/payables`: 201 with the payable and its Location. */
export async function createPayableResponse(req: Request): Promise<Response> {
  return createPayableFrom(await readJson(req));
}

/** The create, shared by the API route and the page's form (H4): the parsed body in, the API's answer out. */
export async function createPayableFrom(body: unknown): Promise<Response> {
  const parsed = CreatePayableBody.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new HttpProblem(400, "body_invalid", "the body does not match the payable schema", { issues });
  }
  const { config, db } = serverContext();
  const p = await createPayable(db, { orgId: config.orgId, ...parsed.data });
  return json(201, payableJson(p), { Location: `/api/payables/${p.id}` });
}

/** `GET /api/payables`: newest first. */
export async function listPayablesResponse(): Promise<Response> {
  const { config, db } = serverContext();
  return json(200, { payables: (await listPayables(db, config.orgId)).map(payableJson) });
}

/** `GET /api/payables/:id`: 404 for an unknown id and for anything that is not a UUIDv7. */
export async function getPayableResponse(id: string): Promise<Response> {
  const { config, db } = serverContext();
  const p = UUID_V7.test(id) ? await getPayable(db, config.orgId, id) : undefined;
  if (!p) return problem(404, "payable_not_found", "no payable with this id");
  return json(200, payableJson(p));
}
