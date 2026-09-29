"use client";

import { useActionState } from "react";
import type { ActionOutcome } from "../../../lib/view/outcome.ts";
import { approveAction, issueAction, lockRateAction, payAction } from "./actions.ts";

const TONE: Record<ActionOutcome["tone"], string> = {
  neutral: "tone-neutral",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
};

function Result({ outcome }: { outcome: ActionOutcome | null }) {
  return (
    <div aria-live="polite">
      {outcome && (
        <p className={`callout block ${TONE[outcome.tone]}`}>
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
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Paying…" : again ? "Submit again (looks for the payment on chain first)" : `Pay ${totalText}`}
      </button>
      <Result outcome={outcome} />
    </form>
  );
}

/** Approve the batch as shown (slice I3): the total and the lock the page showed go with the form. */
export function ApproveForm({ id, totalZat, totalText, lockSeq, rate }: { id: string; totalZat: string; totalText: string; lockSeq: number; rate: string }) {
  const [outcome, formAction, pending] = useActionState(approveAction, null);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="batchId" value={id} />
      <input type="hidden" name="confirmTotalZat" value={totalZat} />
      <input type="hidden" name="lockSeq" value={lockSeq} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Approving…" : `Approve paying ${totalText} at ${rate}`}
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
      <button type="submit" disabled={pending} className="btn btn-accent">
        {pending ? "Issuing…" : "Issue receipts"}
      </button>
      <Result outcome={outcome} />
    </form>
  );
}

/** Lock the draft's ZEC/USD rate from the configured source, or re-lock it (a new lock becomes current). */
export function LockRateForm({ id, locked }: { id: string; locked: boolean }) {
  const [outcome, formAction, pending] = useActionState(lockRateAction, null);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="batchId" value={id} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? "Asking the source…" : locked ? "Re-lock rate" : "Lock rate"}
      </button>
      <Result outcome={outcome} />
    </form>
  );
}
