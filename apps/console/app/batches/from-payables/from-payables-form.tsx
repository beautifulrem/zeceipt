"use client";

import { useActionState } from "react";
import { EMPTY_FROM_PAYABLES, type FromPayablesFormState } from "../../../lib/view/from-payables-form.ts";
import { createBatchFromPayablesAction } from "./actions.ts";

const INITIAL: FromPayablesFormState = { submission: 0, values: EMPTY_FROM_PAYABLES, top: [], title: [], choice: [], byPayable: {} };

export interface Choice {
  id: string;
  reference: string;
  recipient: string;
  kind: string;
  dollars: string;
  /** REQ-CON-6 (slice H6): a receipt already disclosed this payable's recipient address. */
  warning?: string;
}

function Errors({ list }: { list?: string[] }) {
  return list?.length ? (
    <ul role="alert" className="field-error">
      {list.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  ) : null;
}

/**
 * Choose free payables and make a batch at today's rate (slice H5b). GOV.UK checkboxes (R81): a fieldset with a
 * legend, each box left of its label, nothing pre-selected; after an error the operator's own choices stay.
 */
export function FromPayablesForm({ choices }: { choices: Choice[] }) {
  const [state, formAction, pending] = useActionState(createBatchFromPayablesAction, INITIAL);
  const chosen = new Set(state.values.payableIds);
  return (
    <form action={formAction} key={state.submission} className="space-y-4 card">
      <Errors list={state.top} />
      <label className="label">
        Title
        <input name="title" defaultValue={state.values.title} placeholder="September contributors" aria-invalid={state.title.length ? true : undefined} className={`input${state.title.length ? " input-invalid" : ""}`} />
        <Errors list={state.title} />
      </label>
      <fieldset aria-describedby="choose-hint" aria-invalid={state.choice.length ? true : undefined}>
        <legend className="text-sm font-semibold">Payables to pay</legend>
        <p id="choose-hint" className="text-sm text-muted">
          Select up to 50.
        </p>
        <Errors list={state.choice} />
        <ul className="mt-2 divide-y divide-line">
          {choices.map((c) => (
            <li key={c.id} className="py-2">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="payableIds" value={c.id} defaultChecked={chosen.has(c.id)} className="mt-1" />
                <span>
                  <code>{c.reference}</code> · {c.dollars} · {c.kind}
                  <span className="block text-xs text-muted">{c.recipient}</span>
                  {c.warning && (
                    <span className="block text-xs text-warning">
                      {c.warning}{" "}
                      <a href="#linkability" className="underline">
                        Why this matters
                      </a>
                    </span>
                  )}
                </span>
              </label>
              <Errors list={state.byPayable[c.id]} />
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="text-sm text-muted">The ZEC/USD rate is quoted when you press the button and fixed for this batch: a batch made from payables cannot be re-locked.</p>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Quoting the rate…" : "Make batch at today's rate"}
      </button>
    </form>
  );
}
