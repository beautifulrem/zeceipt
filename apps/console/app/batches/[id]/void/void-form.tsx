"use client";

import Link from "next/link";
import { useActionState } from "react";
import { voidBatchAction, type VoidFormState } from "./actions.ts";

const INITIAL: VoidFormState = { submission: 0 };

/**
 * The final step (GOV.UK, R83): the only destructive control is a warning-styled button whose text says what it does;
 * the consequences are stated above it in words, so the colour is never the only signal. "Cancel" changes nothing.
 * The form always renders, so a refused post (a stale page: paid or voided in between) shows its reason even though
 * the batch is no longer voidable and the button is gone.
 */
export function VoidForm({ id, canVoid, reason }: { id: string; canVoid: boolean; reason: string }) {
  const [state, formAction, pending] = useActionState(voidBatchAction, INITIAL);
  return (
    <form action={formAction} key={state.submission} className="space-y-3">
      <input type="hidden" name="batchId" value={id} />
      {state.error && (
        <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm">
          <strong>Not voided:</strong> {state.error}
        </p>
      )}
      {canVoid ? (
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className="rounded-md bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Voiding…" : "Void this batch"}
          </button>
          <Link href={`/batches/${id}`} className="text-sm text-sky-700 underline">
            Cancel
          </Link>
        </div>
      ) : (
        <p className="text-sm">
          {reason}{" "}
          <Link href={`/batches/${id}`} className="text-sky-700 underline">
            Back to the batch
          </Link>
        </p>
      )}
    </form>
  );
}
