"use client";

import { useActionState } from "react";
import type { ActionOutcome } from "../../../lib/view/outcome.ts";
import { issueAction, payAction } from "./actions.ts";

const TONE: Record<ActionOutcome["tone"], string> = {
  neutral: "border-slate-300 bg-slate-50",
  info: "border-sky-300 bg-sky-50",
  success: "border-emerald-300 bg-emerald-50",
  warning: "border-amber-300 bg-amber-50",
  danger: "border-rose-300 bg-rose-50",
};

function Result({ outcome }: { outcome: ActionOutcome | null }) {
  return (
    <div aria-live="polite">
      {outcome && (
        <p className={`rounded-md border px-3 py-2 text-sm ${TONE[outcome.tone]}`}>
          <strong>{outcome.headline}:</strong> {outcome.detail}
        </p>
      )}
    </div>
  );
}

/** Pay the batch: the button names the amount, and the form posts the total the page showed as the confirmation. */
export function PayForm({ id, totalZat, totalText, again }: { id: string; totalZat: string; totalText: string; again: boolean }) {
  const [outcome, formAction, pending] = useActionState(payAction, null);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="batchId" value={id} />
      <input type="hidden" name="confirmTotalZat" value={totalZat} />
      <button type="submit" disabled={pending} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Paying…" : again ? "Submit again (looks for the payment on chain first)" : `Pay ${totalText}`}
      </button>
      <Result outcome={outcome} />
    </form>
  );
}

export function IssueForm({ id }: { id: string }) {
  const [outcome, formAction, pending] = useActionState(issueAction, null);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="batchId" value={id} />
      <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Issuing…" : "Issue receipts"}
      </button>
      <Result outcome={outcome} />
    </form>
  );
}
