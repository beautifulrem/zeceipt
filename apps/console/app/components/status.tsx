import { AlertTriangle, CheckCircle2, Circle, CircleDot } from "lucide-react";
import type { StateView, Tone } from "../../lib/view/status.ts";
import { stepsFor } from "../../lib/view/status.ts";

// Colour follows the tone, but the label always says it in words (frontend spec: text, not colour alone).
const TONE: Record<Tone, string> = {
  neutral: "tone-neutral",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
};

export function StatusBadge({ view }: { view: Pick<StateView, "label" | "tone"> }) {
  return <span className={`badge ${TONE[view.tone]}`}>{view.label}</span>;
}

const MARK = { done: "Done", current: "Current", blocked: "Needs attention", ahead: "Not yet" } as const;
const ICON = { done: CheckCircle2, current: CircleDot, blocked: AlertTriangle, ahead: Circle } as const;

export function Lifecycle({ view }: { view: Pick<StateView, "step" | "blocked"> }) {
  return (
    <ol className="stepper" aria-label="Payment lifecycle">
      {stepsFor(view).map((s) => {
        const Icon = ICON[s.mark];
        return (
          <li key={s.label} data-mark={s.mark} aria-current={s.mark === "current" || s.mark === "blocked" ? "step" : undefined} className="step">
            <span className="step-label">
              <Icon aria-hidden="true" strokeWidth={2} />
              <span>{s.label}</span>
            </span>
            <span className="step-mark">({MARK[s.mark]})</span>
          </li>
        );
      })}
    </ol>
  );
}
