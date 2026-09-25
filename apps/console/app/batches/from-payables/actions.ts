"use server";

// Make a batch from the chosen payables (slice H5b), through the same handler as POST /api/batches/from-payables, so
// the page keeps every API rule (H5a). Unbound (E2's finding): the action takes only (prev, form).

import { redirect } from "next/navigation";
import { createFromPayablesFrom, payableBatchesProblem } from "../../../lib/http/payable-batches.ts";
import { payableHolders } from "../../../lib/data/payable-status.ts";
import { getPayable } from "../../../lib/data/payables.ts";
import { answer } from "../../../lib/http/route.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { CHOOSE_ONE, fromPayablesFormErrors, readFromPayablesForm, type FromPayablesFormState, type PostedPayable } from "../../../lib/view/from-payables-form.ts";

export async function createBatchFromPayablesAction(prev: FromPayablesFormState, form: FormData): Promise<FromPayablesFormState> {
  const values = readFromPayablesForm(form);
  const next = { submission: prev.submission + 1, values, top: [], title: [], choice: [], byPayable: {} };
  // Nothing chosen is the form's own error: no quote is spent and the API is not called.
  if (values.payableIds.length === 0) return { ...next, choice: [CHOOSE_ONE] };
  const res = await answer(() => createFromPayablesFrom({ title: values.title, payableIds: values.payableIds }), payableBatchesProblem);
  if (res.status !== 201) {
    // The posted payables' references and holders, so a problem about one no longer offered can name it and its
    // batch (review H5b). A failed lookup (say the store is busy) leaves `known` undefined: nothing is claimed about
    // the payables then, rather than calling them gone (review H5b round 2).
    const { config, db } = serverContext();
    let known: Record<string, PostedPayable> | undefined;
    try {
      const holders = await payableHolders(db, config.orgId);
      known = {};
      for (const id of values.payableIds) {
        const p = await getPayable(db, config.orgId, id);
        if (p) known[id] = { reference: p.reference, ...(holders.get(id) ? { heldBy: holders.get(id)!.title } : {}) };
      }
    } catch {
      known = undefined;
    }
    return { ...next, ...fromPayablesFormErrors((await res.json()) as Parameters<typeof fromPayablesFormErrors>[0], values.payableIds, known) };
  }
  const { id } = (await res.json()) as { id: string };
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise (R64).
  redirect(`/batches/${id}`);
}
