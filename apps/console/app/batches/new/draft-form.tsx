"use client";

import { Fragment, useActionState, useState } from "react";
import { addLine, editableLines, removeLine, updateLine, type DraftFormState, type DraftLine, type EditableLine, type LineField } from "../../../lib/view/draft-form.ts";
import { createDraftAction } from "./actions.ts";

const COLUMNS: { field: LineField; label: string; width: string; placeholder?: string }[] = [
  { field: "payableId", label: "Payable id", width: "w-28", placeholder: "INV-001" },
  { field: "label", label: "Payee", width: "w-28", placeholder: "Alice" },
  { field: "address", label: "Address", width: "w-full" },
  { field: "amount", label: "Amount (ZEC)", width: "w-28", placeholder: "0.25" },
  { field: "memo", label: "Memo", width: "w-36", placeholder: "INV-001" },
];

function Lines({ initial, errors, addressHint }: { initial: DraftLine[]; errors: Record<number, string[]>; addressHint: string }) {
  // Controlled inputs keyed by a stable line id (review E2b round 1): "Remove" must remove the line clicked,
  // with its values and its errors, never the last row. Names stay positional for posting.
  const [lines, setLines] = useState<EditableLine[]>(() => editableLines(initial, errors));
  return (
    <>
      <table className="w-full text-left text-sm" data-form-grid>
        <caption className="sr-only">Payment lines</caption>
        <thead className="text-slate-500">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.field} className="pb-1 font-medium">
                {c.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, n) => (
            <Fragment key={line.id}>
              <tr className="align-top">
                {COLUMNS.map((c) => (
                  <td key={c.field} className="py-1 pr-2">
                    <input
                      name={`lines.${n}.${c.field}`}
                      aria-label={`Line ${n + 1} ${c.label}`}
                      aria-invalid={line.errors.length ? true : undefined}
                      value={line.values[c.field]}
                      onChange={(e) => setLines((ls) => updateLine(ls, line.id, c.field, e.target.value))}
                      placeholder={c.field === "address" ? addressHint : c.placeholder}
                      inputMode={c.field === "amount" ? "decimal" : undefined}
                      className={`${c.width} rounded border px-2 py-1 ${line.errors.length ? "border-rose-400" : "border-slate-300"}`}
                    />
                  </td>
                ))}
                <td className="py-1">
                  <button type="button" onClick={() => setLines((ls) => removeLine(ls, line.id))} className="text-sm text-slate-500 underline" aria-label={`Remove line ${n + 1}`}>
                    Remove
                  </button>
                </td>
              </tr>
              {/* The line's problems right under it, and they move with it. */}
              {line.errors.length ? (
                <tr>
                  <td colSpan={6} role="alert" className="pb-2 text-sm text-rose-800">
                    Line {n + 1}: {line.errors.join("; ")}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setLines((ls) => addLine(ls))} className="text-sm text-sky-700 underline">
        + Add line
      </button>
    </>
  );
}

export function DraftForm({ initial, addressHint }: { initial: DraftFormState; addressHint: string }) {
  const [state, formAction, pending] = useActionState(createDraftAction, initial);
  return (
    <form action={formAction} className="space-y-4">
      {state.top.length > 0 && (
        <ul role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {state.top.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Title</span>
        <input name="title" defaultValue={state.title} key={`t${state.submission}`} required className="w-full rounded border border-slate-300 px-2 py-1" placeholder="October contributors" />
      </label>
      {/* Keyed by submission: after an error the lines re-render with what was submitted. */}
      <Lines key={state.submission} initial={state.lines} errors={state.lineErrors} addressHint={addressHint} />
      <p className="text-sm text-slate-600">Blank lines are ignored. Amounts are in ZEC with up to 8 decimal places. Nothing is paid until you press Pay on the batch page.</p>
      <button type="submit" disabled={pending} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Creating…" : "Create draft"}
      </button>
    </form>
  );
}
