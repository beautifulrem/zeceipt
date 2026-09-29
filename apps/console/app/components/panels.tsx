import { KeyRound, Network, ShieldAlert, Timer, Wallet } from "lucide-react";
import type { PaymentMode } from "../../lib/view/mode.ts";
import { ACCESS_NOTICE } from "../../lib/view/mode.ts";
import { Words } from "./words.tsx";

// Shown once, in the shell (layout.tsx), on every page (review F round 3: a banner on every page's first screen
// trained the eye to skip it and pushed the page's own state down).
export function AccessNotice({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`callout tone-warning py-2 text-[0.8125rem] ${className}`}>
      <ShieldAlert aria-hidden="true" strokeWidth={1.75} />
      <span>
        <strong>Access:</strong> <Words text={ACCESS_NOTICE} />
      </span>
    </p>
  );
}

export function ModePanel({ mode, compact = false }: { mode: PaymentMode; compact?: boolean }) {
  const rows = [
    ["Custody", mode.custody, KeyRound],
    ["Wallet", mode.wallet, Wallet],
    ["Network", mode.network, Network],
    ["Receipts", mode.confirmations, Timer],
  ] as const;
  return (
    <section aria-labelledby="mode-heading" className="card">
      <h2 id="mode-heading" className="section-title mb-3">
        Payment mode
      </h2>
      <dl className={`grid gap-x-6 gap-y-3 text-sm ${compact ? "" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {rows.map(([k, v, Icon]) => (
          <div key={k} className="flex min-w-0 gap-3">
            <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 flex-none text-muted" />
            <div className="min-w-0">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
