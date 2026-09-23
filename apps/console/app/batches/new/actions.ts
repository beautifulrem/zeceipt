"use server";

// Create a draft from the page's form (slice E2b), through the same handler as POST /api/batches, so the
// form keeps every API rule. Unbound (E2's finding): the action takes only (prev, form).

import { redirect } from "next/navigation";
import { batchProblem, createBatchFrom } from "../../../lib/http/batches.ts";
import { answer } from "../../../lib/http/route.ts";
import { parseDraftForm, problemsByLine, type ApiProblem, type DraftFormState } from "../../../lib/view/draft-form.ts";

export async function createDraftAction(prev: DraftFormState, form: FormData): Promise<DraftFormState> {
  const parsed = parseDraftForm(form);
  const keep = { title: parsed.title, lines: parsed.lines, submission: prev.submission + 1 };
  if (!parsed.body) return { ...keep, top: [], lineErrors: parsed.lineErrors };
  const res = await answer(() => createBatchFrom(parsed.body), batchProblem);
  const body = (await res.json()) as ApiProblem & { id?: string };
  if (res.status !== 201 || !body.id) {
    const where = problemsByLine(body, parsed.lineMap);
    return { ...keep, top: where.top, lineErrors: where.lines };
  }
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise (Next docs).
  redirect(`/batches/${body.id}`);
}
