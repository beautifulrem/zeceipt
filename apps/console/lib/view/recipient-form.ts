// The recipient form's pure pieces (slice H2): read the posted fields, build the API body, and put the API's
// problems where the operator looks: each under its field, the rest at the top (E2b's rule).

export const RECIPIENT_FIELDS = ["displayName", "address", "kycStatus", "taxFlag", "settlementPref", "notes"] as const;
export type RecipientField = (typeof RECIPIENT_FIELDS)[number];
export type RecipientFormValues = Record<RecipientField, string>;

export interface RecipientFormState {
  /** Bumps on every submission, so the form's inputs re-mount with the submitted values. */
  submission: number;
  values: RecipientFormValues;
  top: string[];
  fields: Partial<Record<RecipientField, string[]>>;
}

export const EMPTY_RECIPIENT: RecipientFormValues = { displayName: "", address: "", kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "" };

export function readRecipientForm(form: FormData): RecipientFormValues {
  const get = (k: RecipientField) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  return { displayName: get("displayName").trim(), address: get("address").trim(), kycStatus: get("kycStatus"), taxFlag: get("taxFlag"), settlementPref: get("settlementPref"), notes: get("notes") };
}

/** The API body: exactly what `POST /api/recipients` takes (empty notes are omitted, not sent as ""). */
export function recipientBody(v: RecipientFormValues): Record<string, string> {
  const body: Record<string, string> = { displayName: v.displayName, address: v.address, kycStatus: v.kycStatus, taxFlag: v.taxFlag, settlementPref: v.settlementPref };
  if (v.notes !== "") body.notes = v.notes;
  return body;
}

interface ApiProblemBody {
  detail?: string;
  problems?: { field?: string; detail: string }[];
  issues?: { path: string; message: string }[];
}

const isField = (f: string | undefined): f is RecipientField => (RECIPIENT_FIELDS as readonly string[]).includes(f ?? "");

/** 422 problems by `field`, 400 issues by the first path segment; anything else (and the detail) at the top. */
export function recipientFormErrors(body: ApiProblemBody): Pick<RecipientFormState, "top" | "fields"> {
  const fields: RecipientFormState["fields"] = {};
  const top: string[] = [];
  const put = (f: string | undefined, text: string) => {
    if (isField(f)) (fields[f] ??= []).push(text);
    else top.push(text);
  };
  for (const p of body.problems ?? []) put(p.field, p.detail);
  for (const i of body.issues ?? []) put(i.path.split(".")[0], i.message);
  if (!body.problems?.length && !body.issues?.length && body.detail) top.push(body.detail);
  return { top, fields };
}
