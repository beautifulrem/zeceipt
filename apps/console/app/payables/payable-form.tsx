"use client";

import { useActionState } from "react";
import { EMPTY_PAYABLE, type PayableField, type PayableFormState } from "../../lib/view/payable-form.ts";
import { createPayableAction } from "./actions.ts";

const INITIAL: PayableFormState = { submission: 0, values: EMPTY_PAYABLE, top: [], fields: {} };

function Errors({ list }: { list?: string[] }) {
  return list?.length ? (
    <ul role="alert" className="field-error">
      {list.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  ) : null;
}

const input = (bad: boolean) => `input${bad ? " input-invalid" : ""}`;

/**
 * Add one payable; errors appear under their field and the entered values stay (E2b's rule). The amount follows
 * GOV.UK's money input (R79): text with inputmode="decimal" (never type="number"), a "$" prefix hidden from screen
 * readers, and the unit in the label.
 */
export function PayableForm({ recipients }: { recipients: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createPayableAction, INITIAL);
  const v = state.values;
  const f = (k: PayableField) => state.fields[k];
  const invalid = (k: PayableField) => (f(k) ? true : undefined);
  return (
    <form action={formAction} key={state.submission} className="space-y-3 card">
      <h2 className="eyebrow">Add a payable</h2>
      <Errors list={state.top} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">
          Recipient
          {/* Who gets paid is a question, not a setting: nothing pre-selected (GOV.UK Select, review H4). */}
          <select name="recipientId" defaultValue={v.recipientId} aria-invalid={invalid("recipientId")} className={input(!!f("recipientId"))}>
            <option value="">Choose a recipient</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <Errors list={f("recipientId")} />
        </label>
        <label className="label">
          Kind
          <select name="kind" defaultValue={v.kind} aria-invalid={invalid("kind")} className={input(!!f("kind"))}>
            <option value="invoice">Invoice</option>
            <option value="milestone">Milestone</option>
            <option value="bounty">Bounty</option>
            <option value="salary">Salary</option>
          </select>
          <Errors list={f("kind")} />
        </label>
        <label className="label">
          Amount, in US dollars
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="text-muted">
              $
            </span>
            <input name="amount" defaultValue={v.amount} inputMode="decimal" spellCheck={false} placeholder="1,234.56" aria-invalid={invalid("amount")} className={`${input(!!f("amount"))} tabular-nums`} />
          </span>
          <Errors list={f("amount")} />
        </label>
        <label className="label">
          Reference (becomes the memo)
          <input name="reference" defaultValue={v.reference} spellCheck={false} placeholder="INV-2026-09-01" aria-invalid={invalid("reference")} className={input(!!f("reference"))} />
          <Errors list={f("reference")} />
        </label>
        <label className="label sm:col-span-2">
          Source link (optional: the grant, issue or invoice)
          <input name="sourceUrl" defaultValue={v.sourceUrl} inputMode="url" spellCheck={false} placeholder="https://github.com/org/repo/issues/7" aria-invalid={invalid("sourceUrl")} className={input(!!f("sourceUrl"))} />
          <Errors list={f("sourceUrl")} />
        </label>
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Adding…" : "Add payable"}
      </button>
    </form>
  );
}
