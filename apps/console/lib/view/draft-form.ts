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
  /** Form-level problems found before calling the handler (no lines, too many lines). */
  top: string[];
}

export interface DraftFormState {
  title: string;
  lines: DraftLine[];
  /** Messages that belong to no line (title, "add at least one line", …). */
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
    } catch (e) {
      const tooMuch = e instanceof RangeError && /exceeds 21M/.test(e.message);
      (lineErrors[n] ??= []).push(tooMuch ? "amount: more than 21 million ZEC" : "amount: a ZEC amount with at most 8 decimal places, like 0.25");
      return;
    }
    lineMap.push(n);
    items.push({ payableId: l.payableId.trim(), ...(l.label.trim() ? { label: l.label.trim() } : {}), address: l.address.trim(), zat, memo: l.memo });
  });
  // The API's own limits, said in the form's words before it is called (review E2b round 1).
  const top: string[] = [];
  if (Object.keys(lineErrors).length === 0 && items.length === 0) top.push("Add at least one line.");
  if (items.length > MAX_LINES) top.push(`At most ${MAX_LINES} lines per batch.`);
  const ok = Object.keys(lineErrors).length === 0 && top.length === 0;
  return { title, lines, lineMap, lineErrors, top, ...(ok ? { body: { title: title.trim(), items } } : {}) };
}

/** The API's recipient limit (D1: `items` 1–50). */
export const MAX_LINES = 50;

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
    const field = m?.[2] === "zat" ? "amount" : m?.[2]; // the form's column, not the API's field
    add(m ? Number(m[1]) : undefined, field ? `${field}: ${i.message}` : i.path ? `${i.path}: ${i.message}` : i.message);
  }
  for (const p of body.problems ?? []) add(p.index, p.detail);
  if (top.length === 0 && Object.keys(lines).length === 0 && body.detail) top.push(body.detail);
  return { top, lines };
}

/**
 * A line being edited in the browser (review E2b round 1). Each line has a stable id, so React keys rows by
 * identity, not position: keyed by index with uncontrolled inputs, "Remove line 1" removed the LAST row and
 * kept line 1's typed values (reproduced: removing Alice's line dropped Carol's). The values are held here
 * (controlled inputs), and a line's errors travel with it.
 */
export interface EditableLine {
  id: number;
  values: DraftLine;
  errors: string[];
}

export function editableLines(lines: DraftLine[], lineErrors: Record<number, string[]>): EditableLine[] {
  return lines.map((values, n) => ({ id: n, values: { ...values }, errors: lineErrors[n] ?? [] }));
}

export function addLine(lines: EditableLine[]): EditableLine[] {
  const id = lines.reduce((m, l) => Math.max(m, l.id), -1) + 1;
  return [...lines, { id, values: { ...BLANK_LINE }, errors: [] }];
}

export function removeLine(lines: EditableLine[], id: number): EditableLine[] {
  return lines.filter((l) => l.id !== id);
}

export function updateLine(lines: EditableLine[], id: number, field: LineField, value: string): EditableLine[] {
  return lines.map((l) => (l.id === id ? { ...l, values: { ...l.values, [field]: value } } : l));
}

