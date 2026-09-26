// The Konclave import (REQ-CON-19; `05` §3.6; slice I2): a payroll CSV as Konclave writes and reads it,
// `label,address,value[,memo]` with the value in ZEC (deegalabs/konclave `orchestrator/src/payroll.rs`, R112), turned
// into draft batch lines for the operator to review. Pure: it parses and reports; the draft form's own rules (addresses,
// memo uniqueness) apply when the draft is created. Two deliberate differences from Konclave: a first row is a header
// only when it holds the column names (Konclave drops any first row whose amount does not parse, silently), and an empty
// memo takes the operator's prefix (Konclave allows none; the console's memo is the payment's reference).

import { MAX_ZAT } from "../execution/money.ts";
import type { DraftLine } from "../view/draft-form.ts";

/** The batch limit (B1), which is also the import's limit (`05` §3.6). */
export const IMPORT_MAX_ROWS = 50;

export interface ImportRefusal {
  /** The row's line in the file, counted from 1. */
  sourceLine: number;
  reason: string;
}

export interface KonclaveImport {
  lines: (DraftLine & { sourceLine: number })[];
  refused: ImportRefusal[];
  /** Lines whose memo was made from the prefix, so the form can say so. */
  madeMemos: { sourceLine: number; memo: string }[];
}

const HEADER = ["label", "address", "value"];

/** Konclave's `from_zec_str`: digits and one point (`.5` and `5.` allowed), no sign or separators, at most 8 decimals, at most 21M ZEC. */
export function konclaveZecToZat(field: string): bigint | undefined {
  const s = field.trim();
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  if (whole === "" && frac === "") return undefined;
  if (frac.length > 8 || !/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return undefined;
  const zat = BigInt(whole || "0") * 100_000_000n + BigInt((frac || "0").padEnd(8, "0"));
  // Konclave's `Zatoshis::from_u64` refuses more than the 21M ZEC supply, and its parse refuses u64 overflow.
  return zat > MAX_ZAT ? undefined : zat;
}

/** Zatoshi as the draft form's amount field writes it (`1.5`, `0.00000001`, `2`). */
function zatToZec(zat: bigint): string {
  const whole = zat / 100_000_000n;
  const frac = (zat % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Split on the first three commas (Rust's `splitn(4, ',')`): the memo keeps its commas. */
function splitn4(row: string): string[] {
  const parts: string[] = [];
  let rest = row;
  for (let i = 0; i < 3; i++) {
    const at = rest.indexOf(",");
    if (at === -1) break;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  parts.push(rest);
  return parts;
}

function isHeader(row: string): boolean {
  const cells = row.split(",").map((c) => c.trim().toLowerCase());
  return (cells.length === 3 || (cells.length === 4 && cells[3] === "memo")) && HEADER.every((h, i) => cells[i] === h);
}

export function parseKonclaveCsv(text: string, opts: { memoPrefix: string }): KonclaveImport {
  const rows = text
    .split(/\r?\n/)
    .map((row, i) => ({ sourceLine: i + 1, row }))
    .filter((r) => r.row.trim() !== "");
  if (rows.length > 0 && isHeader(rows[0].row)) rows.shift();

  const prefix = opts.memoPrefix.trim();
  const out: KonclaveImport = { lines: [], refused: [], madeMemos: [] };
  for (const { sourceLine, row } of rows) {
    const refuse = (reason: string) => out.refused.push({ sourceLine, reason });
    const parts = splitn4(row);
    if (parts.length < 3) {
      refuse("expected columns: label,address,value[,memo]");
      continue;
    }
    const address = parts[1].trim();
    if (!address) {
      refuse("empty address");
      continue;
    }
    const zat = konclaveZecToZat(parts[2]);
    if (zat === undefined) {
      refuse(`invalid amount '${parts[2].trim()}'`);
      continue;
    }
    if (zat === 0n) {
      refuse("amount must be greater than zero");
      continue;
    }
    let memo = (parts[3] ?? "").trim();
    if (!memo) {
      if (!prefix) {
        refuse("no memo, and no memo prefix was given for rows without one");
        continue;
      }
      memo = `${prefix}-${sourceLine}`;
      out.madeMemos.push({ sourceLine, memo });
    }
    if (out.lines.length >= IMPORT_MAX_ROWS) {
      refuse(`a batch holds at most ${IMPORT_MAX_ROWS} lines`);
      continue;
    }
    out.lines.push({ sourceLine, payableId: `row-${sourceLine}`, label: parts[0].trim(), address, amount: zatToZec(zat), memo });
  }
  // A made memo on a refused row is not made.
  out.madeMemos = out.madeMemos.filter((m) => out.lines.some((l) => l.sourceLine === m.sourceLine));
  return out;
}
