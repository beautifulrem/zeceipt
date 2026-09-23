import type { StateView, Tone } from "../../lib/view/status.ts";
import { stepsFor } from "../../lib/view/status.ts";

// Colour follows the tone, but the label always says it in words (frontend spec: text, not colour alone).
const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-800 ring-slate-300",
  info: "bg-sky-50 text-sky-900 ring-sky-300",
  success: "bg-emerald-50 text-emerald-900 ring-emerald-300",
  warning: "bg-amber-50 text-amber-900 ring-amber-300",
  danger: "bg-rose-50 text-rose-900 ring-rose-300",
};

export function StatusBadge({ view }: { view: Pick<StateView, "label" | "tone"> }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ${TONE[view.tone]}`}>{view.label}</span>;
}

const MARK = { done: "Done", current: "Current", blocked: "Needs attention", ahead: "Not yet" } as const;

export function Lifecycle({ view }: { view: Pick<StateView, "step" | "blocked"> }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Payment lifecycle">
      {stepsFor(view).map((s) => (
        <li
          key={s.label}
          aria-current={s.mark === "current" || s.mark === "blocked" ? "step" : undefined}
          className={`rounded-md border px-3 py-2 text-sm ${
            s.mark === "done" ? "border-emerald-300 bg-emerald-50" : s.mark === "current" ? "border-sky-400 bg-sky-50 font-semibold" : s.mark === "blocked" ? "border-rose-400 bg-rose-50 font-semibold" : "border-slate-200 text-slate-500"
          }`}
        >
          <span>{s.label}</span>
          <span className="ml-2 text-xs">({MARK[s.mark]})</span>
        </li>
      ))}
    </ol>
  );
}
