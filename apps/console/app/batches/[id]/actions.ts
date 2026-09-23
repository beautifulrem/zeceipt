"use server";

// The page's payment actions (slice E2). Unbound on purpose: the batch id is a form field, not a
// `.bind()` argument. Measured on Next.js 16.3.6: with `useActionState` over a bound action, a no-JS post
// whose form stays on the page (any failure) sent the server into a busy loop (100% CPU, no response);
// unbound, the same post answers in milliseconds. The id is no more exposed than before (bound arguments
// are in the HTML too), and the handlers re-check everything. Each calls the same handler as its API route, so the page answers
// exactly what the API would, then re-renders the page with the new derived status. Server Actions are
// reachable by direct POST (Next's security guide): the handlers apply every rule themselves, and the page
// POST also passes proxy.ts (loopback Host, no cross-site writes) and Next's own Origin check.

import { revalidatePath } from "next/cache";
import { issueReceiptsResponse, issuerCli, receiptsProblem } from "../../../lib/http/receipts.ts";
import { answer } from "../../../lib/http/route.ts";
import { submitBatch } from "../../../lib/http/submit.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { receiptsOutcome, submitOutcome, type ActionOutcome } from "../../../lib/view/outcome.ts";

export async function payAction(_prev: ActionOutcome | null, form: FormData): Promise<ActionOutcome> {
  const id = String(form.get("batchId") ?? "");
  const res = await answer(() => submitBatch(id, async () => ({ confirmTotalZat: String(form.get("confirmTotalZat") ?? "") })));
  revalidatePath(`/batches/${id}`);
  return submitOutcome(res);
}

export async function issueAction(_prev: ActionOutcome | null, form: FormData): Promise<ActionOutcome> {
  const id = String(form.get("batchId") ?? "");
  const res = await answer(() => issueReceiptsResponse(id, issuerCli(serverContext().config)), receiptsProblem);
  revalidatePath(`/batches/${id}`);
  return receiptsOutcome(res);
}
