"use server";

// Add a recipient from the page's form (slice H2), through the same handler as POST /api/recipients, so the form
// keeps every API rule. Unbound (E2's finding): the action takes only (prev, form).

import { redirect } from "next/navigation";
import { createRecipientFrom, recipientsProblem } from "../../lib/http/recipients.ts";
import { answer } from "../../lib/http/route.ts";
import { readRecipientForm, recipientBody, recipientFormErrors, type RecipientFormState } from "../../lib/view/recipient-form.ts";

export async function createRecipientAction(prev: RecipientFormState, form: FormData): Promise<RecipientFormState> {
  const values = readRecipientForm(form);
  const res = await answer(() => createRecipientFrom(recipientBody(values)), recipientsProblem);
  if (res.status !== 201) {
    return { submission: prev.submission + 1, values, ...recipientFormErrors((await res.json()) as Parameters<typeof recipientFormErrors>[0]) };
  }
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise (R64).
  redirect("/recipients");
}
