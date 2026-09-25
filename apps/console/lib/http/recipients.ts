// Recipient routes (slice H1; REQ-CON-2): create one, list them, read one. The network and the org are the
// deployment's own configuration: a body that names either is refused as an unknown key (as batches, D1).
// A duplicate address is not an error: the answer flags it (`duplicateOf`, 05 "flagged not blocked").

import { z } from "zod";
import { createRecipient, getRecipient, KYC_STATUSES, listRecipients, SETTLEMENT_PREFS, TAX_FLAGS, type RecipientProblem, type RecipientRecord } from "../data/recipients.ts";
import { disclosedReceivers, disclosersOf, type Discloser } from "../data/linkability.ts";
import { serverContext } from "../server/context.ts";
import { readJson } from "./body.ts";
import { HttpProblem, problem } from "./problem.ts";

export const CreateRecipientBody = z.strictObject({
  displayName: z.string(),
  address: z.string(),
  kycStatus: z.enum(KYC_STATUSES).optional(),
  taxFlag: z.enum(TAX_FLAGS).optional(),
  settlementPref: z.enum(SETTLEMENT_PREFS).optional(),
  notes: z.string().optional(),
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export function recipientJson(r: RecipientRecord, disclosed: Map<string, Discloser[]> = new Map()) {
  return {
    id: r.id, displayName: r.displayName, address: r.address, network: r.network, kycStatus: r.kycStatus, taxFlag: r.taxFlag, settlementPref: r.settlementPref, notes: r.notes, createdAt: r.createdAt, updatedAt: r.updatedAt, duplicateOf: r.duplicateOf,
    // REQ-CON-6 (slice H6): batches whose receipts already disclosed this address (spec §9); empty when none.
    disclosedBy: disclosersOf(disclosed, r.address, r.network).map((d) => ({ batchId: d.batchId })),
  };
}

/** Domain failures by code (the library loads twice under Next.js, slice E1). */
export function recipientsProblem(e: unknown): Response | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "store_busy") return problem(503, "store_busy", "the database is busy; nothing was saved; retry shortly", {}, { "Retry-After": "1" });
  if (code !== "recipient_invalid") return undefined;
  const problems = (e as { problems?: RecipientProblem[] }).problems ?? [];
  return problem(422, "recipient_invalid", "the recipient was not created; fix every listed problem", { problems: problems.map((p) => ({ code: p.code, field: p.field, detail: p.detail })) });
}

/** `POST /api/recipients`: 201 with the recipient and its Location; a duplicate address is flagged, not refused. */
export async function createRecipientResponse(req: Request): Promise<Response> {
  return createRecipientFrom(await readJson(req));
}

/** The create, shared by the API route and the page's form (H2): the parsed body in, the API's answer out. */
export async function createRecipientFrom(body: unknown): Promise<Response> {
  const parsed = CreateRecipientBody.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new HttpProblem(400, "body_invalid", "the body does not match the recipient schema", { issues });
  }
  const { config, db } = serverContext();
  const r = await createRecipient(db, { orgId: config.orgId, network: config.network, ...parsed.data });
  return json(201, recipientJson(r, await disclosedReceivers(db, config.orgId)), { Location: `/api/recipients/${r.id}` });
}

/** `GET /api/recipients`: newest first, each with its duplicates. */
export async function listRecipientsResponse(): Promise<Response> {
  const { config, db } = serverContext();
  const disclosed = await disclosedReceivers(db, config.orgId);
  return json(200, { recipients: (await listRecipients(db, config.orgId)).map((r) => recipientJson(r, disclosed)) });
}

/** `GET /api/recipients/:id`: 404 for an unknown id and for anything that is not a UUIDv7. */
export async function getRecipientResponse(id: string): Promise<Response> {
  const { config, db } = serverContext();
  const r = UUID_V7.test(id) ? await getRecipient(db, config.orgId, id) : undefined;
  if (!r) return problem(404, "recipient_not_found", "no recipient with this id");
  return json(200, recipientJson(r, await disclosedReceivers(db, config.orgId)));
}
