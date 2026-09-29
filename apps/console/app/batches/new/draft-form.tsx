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
        <thead className="text-muted">
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
                      className={`input mt-0 ${c.width}${line.errors.length ? " input-invalid" : ""}`}
                    />
                  </td>
                ))}
                <td className="py-1">
                  <button type="button" onClick={() => setLines((ls) => removeLine(ls, line.id))} className="link text-sm text-muted" aria-label={`Remove line ${n + 1}`}>
                    Remove
                  </button>
                </td>
              </tr>
              {/* The line's problems right under it, and they move with it. */}
              {line.errors.length ? (
                <tr>
                  <td colSpan={6} role="alert" className="pb-2 text-sm text-danger">
                    Line {n + 1}: {line.errors.join("; ")}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setLines((ls) => addLine(ls))} className="link text-sm">
        + Add line
      </button>
    </>
  );
}

export function DraftForm({ initial, addressHint }: { initial: DraftFormState; addressHint: string }) {
  const [state, formAction, pending] = useActionState(createDraftAction, initial);
  return (
    <form action={formAction} className="card animate-rise-2 space-y-5">
      {state.top.length > 0 && (
        <ul role="alert" className="callout tone-danger block">
          {state.top.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {state.notes && state.notes.length > 0 && (
        <div role="status" className="callout tone-neutral block">
          <ul>
            {state.notes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Title</span>
        <input name="title" defaultValue={state.title} key={`t${state.submission}`} required className="input" placeholder="October contributors" />
      </label>
      {/* Keyed by submission: after an error the lines re-render with what was submitted. */}
      <Lines key={state.submission} initial={state.lines} errors={state.lineErrors} addressHint={addressHint} />
      <p className="text-sm text-muted">Blank lines are ignored. Amounts are in ZEC with up to 8 decimal places. Nothing is paid until you press Pay on the batch page.</p>
      {/* Slice I2 (REQ-CON-19; 05 §3.6): a Konclave payroll CSV fills the lines above for review. */}
      <details className="panel space-y-2 text-sm">
        <summary className="cursor-pointer font-medium">Fill from a Konclave CSV</summary>
        <p className="text-muted">Paste a file in Konclave&apos;s format, label,address,value,memo, with amounts in ZEC. The rows are added below the lines above; nothing is created until you press Create draft.</p>
        <label className="block space-y-1">
          <span>CSV</span>
          <textarea name="csv" rows={6} className="input" placeholder={"label,address,value,memo\nAlice,u1…,0.5,INV-042"} />
        </label>
        <label className="block space-y-1">
          <span>Memo prefix for rows without a memo</span>
          <input name="memoPrefix" className="input w-48" placeholder="PAY-2026-09" />
        </label>
        <button type="submit" name="intent" value="import" formNoValidate disabled={pending} className="btn btn-secondary btn-sm">
          Fill from Konclave CSV
        </button>
      </details>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Creating…" : "Create draft"}
      </button>
    </form>
  );
}
