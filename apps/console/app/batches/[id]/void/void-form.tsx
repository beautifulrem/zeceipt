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
        <p role="alert" className="callout tone-danger block">
          <strong>Not voided:</strong> {state.error}
        </p>
      )}
      {canVoid ? (
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className="btn btn-danger">
            {pending ? "Voiding…" : "Void this batch"}
          </button>
          <Link href={`/batches/${id}`} className="link text-sm">
            Cancel
          </Link>
        </div>
      ) : (
        <p className="text-sm">
          {reason}{" "}
          <Link href={`/batches/${id}`} className="link">
            Back to the batch
          </Link>
        </p>
      )}
    </form>
  );
}
