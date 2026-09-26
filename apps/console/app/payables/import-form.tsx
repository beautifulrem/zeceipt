"use client";

// The zecpay import on the payables page (slice I3b; REQ-CON-19; 05 §3.6): Preview writes nothing; Import writes what
// the preview showed (its fingerprint goes back with the form), all rows or none. Works without JavaScript.

import { useActionState } from "react";
import { PAYABLE_KINDS } from "../../lib/data/payable-rules.ts";
import { TABLE_CLASS } from "../../lib/view/table.ts";
import { Address } from "../components/address.tsx";
import type { ZecpayImportState } from "../../lib/view/zecpay-import.ts";
import { importZecpayAction } from "./import-actions.ts";

const KIND_LABEL: Record<string, string> = { milestone: "Milestone", invoice: "Invoice", bounty: "Bounty", salary: "Salary" };
export const EMPTY_IMPORT: ZecpayImportState = { submission: 0, csv: "", kind: "salary", prefix: "", rows: [], refused: [] };

export function ImportForm() {
  const [state, formAction, pending] = useActionState(importZecpayAction, EMPTY_IMPORT);
  const canImport = state.fingerprint !== undefined && state.rows.length > 0;
  return (
    <>
      {/* Outside the <details>, which closes after an import (review I3b round 2): a closed one hides its content. */}
      {state.notice && (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {state.notice}
        </p>
      )}
      <details open={state.submission > 0 && !state.notice} className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm">
        <summary className="cursor-pointer font-medium">Import payables from a zecpay CSV</summary>
        <form action={formAction} className="space-y-3" key={state.submission}>
          <p className="text-slate-600">
            zecpay&apos;s format, name,wallet,amount,currency,payout_currency, with amounts in US dollars. Preview first: it writes nothing. Import then adds the previewed
            payables, and any new recipients, all together or not at all. Payables and recipients cannot be deleted afterwards.
          </p>
          <label className="block space-y-1">
            <span>CSV</span>
            <textarea name="csv" rows={6} defaultValue={state.csv} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" placeholder={"name,wallet,amount,currency,payout_currency\nAlice,u1…,500,USD,ZEC"} />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="space-y-1">
              <span className="block">Kind of every payable</span>
              <select name="kind" defaultValue={state.kind} className="rounded border border-slate-300 px-2 py-1">
                {PAYABLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block">Reference prefix (each reference is the prefix, a dash and the CSV line)</span>
              <input name="prefix" defaultValue={state.prefix} className="w-56 rounded border border-slate-300 px-2 py-1" placeholder="PAYROLL-2026-09" />
            </label>
          </div>
          {state.message && (
            <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900">
              {state.message}
            </p>
          )}
          {state.rows.length > 0 && (
            <table className={TABLE_CLASS}>
              <caption className="text-left font-medium">Preview: {state.rows.length} {state.rows.length === 1 ? "payable" : "payables"} to add</caption>
              <thead className="text-slate-500">
                <tr>
                  <th>CSV line</th>
                  <th>Recipient</th>
                  <th>Address it will pay</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.sourceLine}>
                    <td>{r.sourceLine}</td>
                    <td>{r.recipient}</td>
                    <td>
                      <Address value={r.address} />
                    </td>
                    <td>{r.amount}</td>
                    <td>{r.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state.refused.length > 0 && (
            <div role="status">
              <ul className="list-disc pl-5 text-slate-700">
                {state.refused.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-3">
            <button type="submit" name="intent" value="preview" disabled={pending} className="rounded-md border border-sky-700 px-3 py-1 font-semibold text-sky-700 disabled:opacity-60">
              Preview
            </button>
            {canImport && (
              <>
                <input type="hidden" name="fingerprint" value={state.fingerprint} />
                <button type="submit" name="intent" value="confirm" disabled={pending} className="rounded-md bg-sky-700 px-3 py-1 font-semibold text-white disabled:opacity-60">
                  Import {state.rows.length} {state.rows.length === 1 ? "payable" : "payables"}
                </button>
              </>
            )}
          </div>
        </form>
      </details>
    </>
  );
}
