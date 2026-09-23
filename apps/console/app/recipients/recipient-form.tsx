"use client";

import { useActionState } from "react";
import { EMPTY_RECIPIENT, type RecipientField, type RecipientFormState } from "../../lib/view/recipient-form.ts";
import { createRecipientAction } from "./actions.ts";

const INITIAL: RecipientFormState = { submission: 0, values: EMPTY_RECIPIENT, top: [], fields: {} };

function Errors({ list }: { list?: string[] }) {
  return list?.length ? (
    <ul role="alert" className="mt-1 text-sm text-rose-800">
      {list.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  ) : null;
}

const input = (bad: boolean) => `w-full rounded border px-2 py-1 ${bad ? "border-rose-400" : "border-slate-300"}`;

/** Add one recipient; errors appear under their field and the entered values stay (E2b's rule). */
export function RecipientForm({ addressHint }: { addressHint: string }) {
  const [state, formAction, pending] = useActionState(createRecipientAction, INITIAL);
  const v = state.values;
  const f = (k: RecipientField) => state.fields[k];
  return (
    <form action={formAction} key={state.submission} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Add a recipient</h2>
      <Errors list={state.top} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Display name
          <input name="displayName" defaultValue={v.displayName} placeholder="Alice (design)" aria-invalid={f("displayName") ? true : undefined} className={input(!!f("displayName"))} />
          <Errors list={f("displayName")} />
        </label>
        <label className="text-sm">
          Unified address
          <input name="address" defaultValue={v.address} placeholder={addressHint} spellCheck={false} aria-invalid={f("address") ? true : undefined} className={`${input(!!f("address"))} font-mono`} />
          <Errors list={f("address")} />
        </label>
        <label className="text-sm">
          KYC status
          <select name="kycStatus" defaultValue={v.kycStatus} className={input(!!f("kycStatus"))}>
            <option value="unknown">Unknown</option>
            <option value="verified">Verified</option>
            <option value="not_required">Not required</option>
          </select>
          <Errors list={f("kycStatus")} />
        </label>
        <label className="text-sm">
          Tax flag
          <select name="taxFlag" defaultValue={v.taxFlag} className={input(!!f("taxFlag"))}>
            <option value="none">None</option>
            <option value="us_1099">US 1099</option>
            <option value="non_us">Non-US</option>
          </select>
          <Errors list={f("taxFlag")} />
        </label>
        <label className="text-sm">
          Settlement preference
          <select name="settlementPref" defaultValue={v.settlementPref} className={input(!!f("settlementPref"))}>
            <option value="zec">ZEC</option>
            <option value="usdc_sol">USDC on Solana (recorded only)</option>
          </select>
          <Errors list={f("settlementPref")} />
        </label>
        <label className="text-sm">
          Notes
          <input name="notes" defaultValue={v.notes} className={input(!!f("notes"))} />
          <Errors list={f("notes")} />
        </label>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Adding…" : "Add recipient"}
      </button>
    </form>
  );
}
