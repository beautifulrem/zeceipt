// What the pages say about a batch's money (slice E1, design 3.3.5.2.2). Every word follows B3's derived
// state, which fails closed; the page never computes a state of its own. Konclave's dashboard once showed
// a green "Confirmed" over a transaction still in the mempool (their settlement.ts): here "confirmed"
// appears only for confirmed, receipts_partial and receipts_issued (unit-tested). Tones are always paired
// with a text label: colour never carries meaning alone.

import type { BatchState, BatchStatus, NextAction } from "../data/status.ts";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Step = "draft" | "approved" | "sent" | "in_block" | "confirmed" | "receipts";

export const LIFECYCLE_STEPS: readonly { step: Step; label: string }[] = [
  { step: "draft", label: "Draft" },
  { step: "approved", label: "Approved" },
  { step: "sent", label: "Sent" },
  { step: "in_block", label: "In a block" },
  { step: "confirmed", label: "Confirmed" },
  { step: "receipts", label: "Receipts" },
];

const MAY_HAVE_SENT = "The payment may have been sent. Do not pay this batch by hand.";

const STATE: Record<BatchState, { label: string; tone: Tone; step: Step; blocked?: true; explanation: string }> = {
  draft: { label: "Draft", tone: "neutral", step: "draft", explanation: "Not approved and not submitted. Nothing has been paid." },
  // Slice I3: approved as it is now, at its current lock; a re-lock or any change to a line needs a new approval.
  approved: { label: "Approved, not sent", tone: "info", step: "approved", explanation: "Approved at the current rate lock. Nothing has been paid yet. Re-locking the rate needs a new approval." },
  submitting: { label: "Submitting", tone: "info", step: "sent", explanation: "A submit is running or was interrupted; the payment may be in progress. Do not pay this batch any other way." },
  retryable: { label: "Not sent, can retry", tone: "warning", step: "draft", explanation: "The last attempt sent nothing. Submitting again is safe." },
  needs_attention: { label: "Outcome unknown", tone: "danger", step: "sent", blocked: true, explanation: MAY_HAVE_SENT },
  pending: { label: "Broadcast, not in a block yet", tone: "info", step: "sent", explanation: "Sent to the network and waiting to be mined. Not confirmed." },
  confirming: { label: "In a block", tone: "info", step: "in_block", explanation: "Mined; waiting for enough blocks on top before receipts." },
  confirmed: { label: "Confirmed", tone: "success", step: "confirmed", explanation: "Paid and confirmed on chain. Receipts can be issued." },
  receipts_partial: { label: "Confirmed, receipts incomplete", tone: "warning", step: "receipts", explanation: "Some receipts are issued; issuing again completes the rest." },
  receipts_issued: { label: "Receipts issued", tone: "success", step: "receipts", explanation: "Paid, confirmed, and one receipt per item issued." },
  voided: { label: "Voided", tone: "neutral", step: "draft", explanation: "Voided before anything was sent. Nothing was paid, and this batch can no longer be paid; its payables are free for a new batch." },
  expired: { label: "Expired, never mined", tone: "danger", step: "sent", blocked: true, explanation: "The transaction can no longer be mined, so nothing was paid by it. Re-sending is a human decision." },
};

export const NEXT_TEXT: Record<NextAction, string> = {
  approve: "Approve the batch (its lines, total and locked rate)",
  submit: "Submit the batch (with its total)",
  wait: "Nothing to do yet",
  issue_receipts: "Issue receipts",
  resend_expired: "Decide whether to re-send",
  record_expiry: "Record the expiry bound",
  investigate: "Investigate: the records disagree",
  none: "Done",
};

export interface StateView {
  label: string;
  tone: Tone;
  step: Step;
  blocked: boolean;
  explanation: string;
  next: string;
}

/** The label, tone, lifecycle step and explanation for a derived status (B3). */
export function stateView(status: BatchStatus): StateView {
  const v = STATE[status.state];
  let label = v.label;
  let explanation = v.explanation;
  const d = status.detail;
  if (status.state === "confirming" && d.confirmations !== undefined && d.required !== undefined) {
    label = `In a block, ${d.confirmations} of ${d.required} confirmations`;
  }
  if (status.state === "needs_attention") {
    // B3 reaches this state four ways; say which, then the rule that holds for all of them.
    const why = d.stale
      ? "A submit started and never finished; submitting again looks for the payment on chain first."
      : d.cause === "timeout"
        ? "Broadcast, but not mined for a long time; it can still be mined until it expires."
        : d.cause
          ? `The records disagree (${d.cause}); investigate.`
          : "The wallet's answer was lost; submitting again looks for the payment on chain first.";
    explanation = `${why} ${MAY_HAVE_SENT}`;
  }
  return { label, tone: v.tone, step: v.step, blocked: v.blocked === true, explanation, next: NEXT_TEXT[status.next] };
}

/**
 * The wallet did not answer (review E1 round 1). B3's reader asks the wallet only when the submission
 * record says broadcast, so the record proves the payment was sent; what is unknown is whether it is in a
 * block or confirmed. Say exactly that, mark the step reached by the record, and warn against paying twice.
 */
export const STATUS_UNAVAILABLE: StateView = {
  label: "Status unavailable",
  tone: "warning",
  step: "sent",
  blocked: true,
  explanation:
    "The payment was broadcast, but the wallet did not answer, so this page cannot say whether it is in a block or confirmed. Do not pay this batch by hand; reload once the wallet is reachable.",
  next: "Reload once the wallet is reachable",
};

/** The lifecycle for display: each step done, current (possibly blocked) or ahead. */
export function stepsFor(view: Pick<StateView, "step" | "blocked"> & { tone?: Tone }): { label: string; mark: "done" | "current" | "blocked" | "ahead" }[] {
  const at = LIFECYCLE_STEPS.findIndex((s) => s.step === view.step);
  // The end of the road (receipts issued, the success tone at the last step) is done, not current: nothing is left to
  // do (review F round 1). Partial receipts stay current.
  const complete = at === LIFECYCLE_STEPS.length - 1 && view.tone === "success";
  return LIFECYCLE_STEPS.map((s, i) => ({ label: s.label, mark: i < at || (i === at && complete) ? "done" : i === at ? (view.blocked ? "blocked" : "current") : "ahead" }));
}
