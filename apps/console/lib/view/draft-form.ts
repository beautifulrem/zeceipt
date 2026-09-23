// The create-draft form's pure pieces (slice E2b): read the form's lines, convert ZEC to zatoshi exactly,
// and put every problem from the API's answer next to the line it belongs to.
//
// Amounts are typed in ZEC and converted with `decimalToZat` (at most 8 places, ≤ 21M ZEC): exact, unlike
// float parsing (ZBooks' payout lines use `Number(amount)`). Blank lines are skipped, so `lineMap` keeps
// each body index pointing at its form line.

import { decimalToZat } from "../execution/money.ts";

export const LINE_FIELDS = ["payableId", "label", "address", "amount", "memo"] as const;
export type LineField = (typeof LINE_FIELDS)[number];
export type DraftLine = Record<LineField, string>;

export interface ParsedDraft {
  title: string;
  lines: DraftLine[];
  /** The API body, when every amount converted. */
  body?: { title: string; items: { payableId: string; label?: string; address: string; zat: string; memo: string }[] };
  /** body item index → form line index */
  lineMap: number[];
  /** Amount errors by form line (the handler is not called when there are any). */
  lineErrors: Record<number, string[]>;
}

export interface DraftFormState {
  title: string;
  lines: DraftLine[];
  top: string[];
  lineErrors: Record<number, string[]>;
  /** Changes on every submission, so the form re-renders with the submitted values. */
  submission: number;
}

export const BLANK_LINE: DraftLine = { payableId: "", label: "", address: "", amount: "", memo: "" };

/** Lines are named `lines.<n>.<field>`; the form lines keep their order and positions. */
export function parseDraftForm(form: FormData): ParsedDraft {
  const title = String(form.get("title") ?? "");
  const byLine = new Map<number, DraftLine>();
  for (const [key, value] of form.entries()) {
    const m = /^lines\.(\d{1,3})\.(payableId|label|address|amount|memo)$/.exec(key);
    if (!m || typeof value !== "string") continue;
    const n = Number(m[1]);
    const line = byLine.get(n) ?? { ...BLANK_LINE };
    line[m[2] as LineField] = value;
    byLine.set(n, line);
  }
  const lines = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  const lineMap: number[] = [];
  const lineErrors: Record<number, string[]> = {};
  const items: NonNullable<ParsedDraft["body"]>["items"] = [];
  lines.forEach((l, n) => {
    if (LINE_FIELDS.every((f) => l[f].trim() === "")) return; // a blank line is not an item
    let zat: string;
    try {
      zat = decimalToZat(l.amount).toString();
    } catch {
      (lineErrors[n] ??= []).push("amount: a ZEC amount with at most 8 decimal places, like 0.25");
      return;
    }
    lineMap.push(n);
    items.push({ payableId: l.payableId.trim(), ...(l.label.trim() ? { label: l.label.trim() } : {}), address: l.address.trim(), zat, memo: l.memo });
  });
  const ok = Object.keys(lineErrors).length === 0;
  return { title, lines, lineMap, lineErrors, ...(ok ? { body: { title: title.trim(), items } } : {}) };
}

export interface ApiProblem {
  detail?: string;
  issues?: { path: string; message: string }[];
  problems?: { code: string; index?: number; detail: string }[];
}

/** The API's 400 issues and 422 problems, by form line; anything without a line goes to the top. */
export function problemsByLine(body: ApiProblem, lineMap: number[]): { top: string[]; lines: Record<number, string[]> } {
  const top: string[] = [];
  const lines: Record<number, string[]> = {};
  const add = (bodyIndex: number | undefined, text: string) => {
    const line = bodyIndex === undefined ? undefined : lineMap[bodyIndex];
    if (line === undefined) top.push(text);
    else (lines[line] ??= []).push(text);
  };
  for (const i of body.issues ?? []) {
    const m = /^items\.(\d+)(?:\.(\w+))?$/.exec(i.path);
    add(m ? Number(m[1]) : undefined, m?.[2] ? `${m[2]}: ${i.message}` : i.path ? `${i.path}: ${i.message}` : i.message);
  }
  for (const p of body.problems ?? []) add(p.index, p.detail);
  if (top.length === 0 && Object.keys(lines).length === 0 && body.detail) top.push(body.detail);
  return { top, lines };
}
