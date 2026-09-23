"use server";

// Add a payable from the page's form (slice H4), through the same handler as POST /api/payables, so the form keeps
// every API rule. The amount is typed in dollars and converted to cents exactly here first; an amount that is not
// dollars, or no recipient chosen, never reaches the API. Unbound (E2's finding): the action takes only (prev, form).

import { redirect } from "next/navigation";
import { createPayableFrom, payablesProblem } from "../../lib/http/payables.ts";
import { answer } from "../../lib/http/route.ts";
import { payableBody, payableFormErrors, readPayableForm, type PayableFormState } from "../../lib/view/payable-form.ts";

export async function createPayableAction(prev: PayableFormState, form: FormData): Promise<PayableFormState> {
  const values = readPayableForm(form);
  const built = payableBody(values);
  if ("fields" in built) return { submission: prev.submission + 1, values, top: [], fields: built.fields };
  const res = await answer(() => createPayableFrom(built.body), payablesProblem);
  if (res.status !== 201) {
    return { submission: prev.submission + 1, values, ...payableFormErrors((await res.json()) as Parameters<typeof payableFormErrors>[0]) };
  }
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise (R64).
  redirect("/payables");
}
