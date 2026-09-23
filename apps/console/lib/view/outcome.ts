// What the page says after an action (slice E2): the API's own answer (the shared handlers' Response),
// in plain language. The detail is the problem's fixed text, never the wallet's. `thisRequest` becomes a
// sentence; an uncertain outcome is headed "Outcome unknown", never shown as a failure (Konclave #280).

import { movedText, pctFromBps } from "../rates/drift.ts";
import { rateText, sourceName } from "./format.ts";
import type { Tone } from "./status.ts";

export interface ActionOutcome {
  tone: Tone;
  headline: string;
  detail: string;
}

interface Body {
  code?: string;
  detail?: string;
  thisRequest?: "sent_nothing" | "may_have_sent";
  txid?: string;
  replayed?: boolean;
  receipts?: unknown[];
  confirmations?: number;
  required?: number;
  rate?: string;
  bid?: string;
  pair?: string;
  source?: string;
  fetchedAt?: string;
  reason?: string;
}

/** A rate_moved problem's `rate` extension (its `rate` is an object; a lock's `rate` is a string). */
type RateMoved = { lock?: string; execution?: string; driftBps?: string; maxDriftBps?: number };

const VERDICT = {
  sent_nothing: "This request sent nothing.",
  may_have_sent: "This request may have paid. Check the status before acting.",
} as const;

/** "detail. Verdict." — the API's details carry no final period. */
function sentence(detail: string | undefined, verdict: string | undefined): string {
  const d = (detail ?? "").trim();
  const head = d && !/[.!?]$/.test(d) ? `${d}.` : d;
  return [head, verdict].filter(Boolean).join(" ");
}

function problemOutcome(b: Body): ActionOutcome {
  const detail = sentence(b.detail, b.thisRequest && VERDICT[b.thisRequest]);
  if (b.thisRequest === "may_have_sent") return { tone: "danger", headline: "Outcome unknown", detail };
  return { tone: "warning", headline: "Not done", detail };
}

export async function submitOutcome(res: Response): Promise<ActionOutcome> {
  const b = (await res.json()) as Body;
  if (res.status === 202) {
    return b.replayed
      ? { tone: "info", headline: "Already sent", detail: `This batch was already sent as ${b.txid}; nothing new was paid.` }
      : { tone: "info", headline: "Broadcast", detail: `Sent as ${b.txid}. Waiting for it to be mined.` };
  }
  // The rate guard (REQ-CON-21, slice G2b2): the API's own numbers, never the source's text.
  const moved = b.code === "rate_moved" ? ((b as { rate?: RateMoved }).rate ?? {}) : undefined;
  if (moved?.lock && moved.execution && moved.driftBps && moved.maxDriftBps) {
    return {
      tone: "warning",
      headline: "Rate moved",
      detail: `ZEC/USD moved ${movedText(moved.driftBps, moved.maxDriftBps)} since the lock (${moved.lock} → ${moved.execution} USD per ZEC); at most ${pctFromBps(moved.maxDriftBps)} is allowed. Re-lock the rate, then pay. ${VERDICT.sent_nothing}`,
    };
  }
  if (b.code === "rate_not_locked") return { tone: "warning", headline: "Not paid", detail: `Lock the ZEC/USD rate first. ${VERDICT.sent_nothing}` };
  if (b.code === "rate_unavailable") {
    return { tone: "warning", headline: "Not paid", detail: `The rate source's answer was unusable (${b.reason ?? "unknown"}), so the rate could not be checked. Try again shortly. ${VERDICT.sent_nothing}` };
  }
  return problemOutcome(b);
}

export async function receiptsOutcome(res: Response): Promise<ActionOutcome> {
  const b = (await res.json()) as Body;
  if (res.status === 200 || res.status === 201) {
    const n = b.receipts?.length ?? 0;
    return { tone: "success", headline: "Receipts issued", detail: `${n} receipt${n === 1 ? "" : "s"} issued, one per item.` };
  }
  if (res.status === 202) {
    return { tone: "info", headline: "Waiting", detail: `Receipts are issued after ${b.required} confirmations; the payment has ${b.confirmations}.` };
  }
  return problemOutcome(b);
}

/** After "Lock rate" (slice G1c2): the new rate with its source and time, or why nothing was locked. */
export async function lockOutcome(res: Response): Promise<ActionOutcome> {
  const b = (await res.json()) as Body;
  if (res.status === 201 && b.rate) {
    return { tone: "success", headline: "Rate locked", detail: `${rateText(b.rate)} (${sourceName(b.source ?? "")} ${b.pair} bid ${b.rate}, fetched ${String(b.fetchedAt).replace("T", " ").slice(0, 19)} UTC).` };
  }
  if (b.code === "rate_unavailable") {
    return { tone: "warning", headline: "Not locked", detail: sentence(b.detail, `The source's answer was unusable (${b.reason ?? "unknown"}); try again shortly.`) };
  }
  return problemOutcome(b);
}
