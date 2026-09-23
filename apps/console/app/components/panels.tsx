import type { PaymentMode } from "../../lib/view/mode.ts";
import { ACCESS_NOTICE } from "../../lib/view/mode.ts";

export function AccessNotice() {
  return (
    <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <strong>Access:</strong> {ACCESS_NOTICE}
    </p>
  );
}

export function ModePanel({ mode }: { mode: PaymentMode }) {
  const rows: [string, string][] = [
    ["Custody", mode.custody],
    ["Wallet", mode.wallet],
    ["Network", mode.network],
    ["Receipts", mode.confirmations],
  ];
  return (
    <section aria-labelledby="mode-heading" className="rounded-lg border border-slate-200 p-4">
      <h2 id="mode-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        Payment mode
      </h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
