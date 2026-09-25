// The "batch from payables" form's pure pieces (slice H5b): read the title and the checked payables (in document
// order, which becomes the batch's line order), and put the API's problems where the operator looks: a problem with
// an index under the payable posted at that index, the title's under the title, the choice's under the fieldset,
// the rate source's at the top in words (design H5b.1.4).

export interface FromPayablesValues {
  title: string;
  payableIds: string[];
}

export interface FromPayablesFormState {
  /** Bumps on every submission, so the form re-mounts with the submitted values. */
  submission: number;
  values: FromPayablesValues;
  top: string[];
  title: string[];
  /** Under the fieldset: the choice as a whole (none, too many). */
  choice: string[];
  /** Under one payable's checkbox, by payable id. */
  byPayable: Record<string, string[]>;
}

export const EMPTY_FROM_PAYABLES: FromPayablesValues = { title: "", payableIds: [] };
export const CHOOSE_ONE = "Choose at least one payable.";
export const SOURCE_DOWN = "The ZEC/USD source did not give a usable quote, so nothing was made. Try again in a moment.";
export const STORE_BUSY = "The database was busy, so nothing was made. Try again in a moment.";
/** GOV.UK style (H4.1.11): an instruction, not the API's rule text. */
export const ENTER_TITLE = "Enter a title for this batch, up to 200 characters.";

export function readFromPayablesForm(form: FormData): FromPayablesValues {
  const title = form.get("title");
  return {
    title: typeof title === "string" ? title.trim() : "",
    payableIds: form.getAll("payableIds").filter((v): v is string => typeof v === "string" && v !== ""),
  };
}

interface ApiProblemBody {
  code?: string;
  detail?: string;
  problems?: { code: string; index?: number; detail: string }[];
  issues?: { path: string; message: string }[];
}

const CHOICE_CODES = new Set(["empty_batch", "too_many_recipients"]);
// A payable taken by another batch, or gone, is not offered when the page re-renders (only free payables are), so
// its problem cannot sit under its checkbox: it goes at the top, naming the payable (review H5b: a page loaded before
// another batch took a payable was refused silently).
const NOT_OFFERED = new Set(["payable_taken", "payable_unknown"]);

/**
 * Where each part of an API answer goes; `posted` is the id list that was sent (so an index finds its payable), and
 * `references` names the posted payables that still exist (id → reference).
 */
export function fromPayablesFormErrors(body: ApiProblemBody, posted: string[], references: Record<string, string> = {}): Pick<FromPayablesFormState, "top" | "title" | "choice" | "byPayable"> {
  const out = { top: [] as string[], title: [] as string[], choice: [] as string[], byPayable: {} as Record<string, string[]> };
  if (body.code === "rate_unavailable") {
    out.top.push(SOURCE_DOWN);
    return out;
  }
  if (body.code === "store_busy") {
    out.top.push(STORE_BUSY);
    return out;
  }
  for (const p of body.problems ?? []) {
    const id = p.index === undefined ? undefined : posted[p.index];
    if (id !== undefined && NOT_OFFERED.has(p.code)) {
      out.top.push(references[id] ? `${references[id]}: ${p.detail}. It is no longer offered.` : "A chosen payable no longer exists, so it is no longer offered.");
    } else if (id !== undefined) (out.byPayable[id] ??= []).push(p.detail);
    else if (p.code === "title_invalid") out.title.push(ENTER_TITLE);
    else if (CHOICE_CODES.has(p.code)) out.choice.push(p.detail);
    else out.top.push(p.detail);
  }
  for (const i of body.issues ?? []) {
    const field = i.path.split(".")[0];
    if (field === "title") out.title.push(i.message);
    else if (field === "payableIds") out.choice.push(i.message);
    else out.top.push(i.message);
  }
  if (!body.problems?.length && !body.issues?.length && body.detail) out.top.push(body.detail);
  return out;
}
