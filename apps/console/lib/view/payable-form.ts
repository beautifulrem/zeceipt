// The payable form's pure pieces (slice H4): read the posted fields, convert the amount, build the API body, and put
// the API's problems where the operator looks: each under its field, a taken reference under the reference, the rest
// at the top (E2b's and H2's rule).

import { dollarsToCents } from "./money-input.ts";

export const PAYABLE_FIELDS = ["recipientId", "kind", "amount", "reference", "sourceUrl"] as const;
export type PayableField = (typeof PAYABLE_FIELDS)[number];
export type PayableFormValues = Record<PayableField, string>;

export interface PayableFormState {
  /** Bumps on every submission, so the form's inputs re-mount with the submitted values. */
  submission: number;
  values: PayableFormValues;
  top: string[];
  fields: Partial<Record<PayableField, string[]>>;
}

export const EMPTY_PAYABLE: PayableFormValues = { recipientId: "", kind: "invoice", amount: "", reference: "", sourceUrl: "" };

export const AMOUNT_HELP = "a US dollar amount with at most 2 decimal places, like 1,234.56";
export const REFERENCE_TAKEN = "Already used by another payable. References become the memo, so each must be unique.";

/** The form's values: the reference and link trimmed (the page's leniency; the API takes text exactly, H3). */
export function readPayableForm(form: FormData): PayableFormValues {
  const get = (k: PayableField) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  return { recipientId: get("recipientId"), kind: get("kind"), amount: get("amount"), reference: get("reference").trim(), sourceUrl: get("sourceUrl").trim() };
}

/** The API body for `POST /api/payables`, or the amount's error when it is not a dollar amount (the API is not called). */
export function payableBody(v: PayableFormValues): { body: Record<string, string | number> } | { amountError: string } {
  const usdCents = dollarsToCents(v.amount);
  if (usdCents === undefined) return { amountError: `Enter ${AMOUNT_HELP}.` };
  const body: Record<string, string | number> = { recipientId: v.recipientId, kind: v.kind, usdCents, reference: v.reference };
  if (v.sourceUrl !== "") body.sourceUrl = v.sourceUrl;
  return { body };
}

interface ApiProblemBody {
  code?: string;
  detail?: string;
  problems?: { field?: string; detail: string }[];
  issues?: { path: string; message: string }[];
}

// The API names the amount `usdCents`; the form calls it `amount`.
const FIELD_OF: Record<string, PayableField> = { recipientId: "recipientId", kind: "kind", usdCents: "amount", reference: "reference", sourceUrl: "sourceUrl" };

/** 422 problems by `field`, a 409 under the reference, 400 issues by the first path segment; the rest at the top. */
export function payableFormErrors(body: ApiProblemBody): Pick<PayableFormState, "top" | "fields"> {
  const fields: PayableFormState["fields"] = {};
  const top: string[] = [];
  const put = (f: string | undefined, text: string) => {
    const field = FIELD_OF[f ?? ""];
    if (field) (fields[field] ??= []).push(text);
    else top.push(text);
  };
  if (body.code === "reference_taken") put("reference", REFERENCE_TAKEN);
  for (const p of body.problems ?? []) put(p.field, p.detail);
  for (const i of body.issues ?? []) put(i.path.split(".")[0], i.message);
  if (body.code !== "reference_taken" && !body.problems?.length && !body.issues?.length && body.detail) top.push(body.detail);
  return { top, fields };
}
