"use server";

// Void a draft from its confirmation page (slice H5d), through the same handler as POST /api/batches/{id}/void, so the
// page keeps every API rule and the route stays the authority. Unbound (E2's finding): the id is a form field.

import { redirect } from "next/navigation";
import { answer } from "../../../../lib/http/route.ts";
import { voidBatchResponse, voidsProblem } from "../../../../lib/http/voids.ts";

export interface VoidFormState {
  submission: number;
  /** The API's answer in words when it refused (a stale page: paid, or voided, in between). */
  error?: string;
}

export async function voidBatchAction(prev: VoidFormState, form: FormData): Promise<VoidFormState> {
  const id = String(form.get("batchId") ?? "");
  const res = await answer(() => voidBatchResponse(id), voidsProblem);
  if (res.status !== 200) {
    const body = (await res.json()) as { detail?: string };
    return { submission: prev.submission + 1, error: body.detail ?? "The batch was not voided." };
  }
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise (R64).
  redirect(`/batches/${id}`);
}
