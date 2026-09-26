// The payable value rules (slices H3 and H4; REQ-CON-3), without the database, so a pure module (the zecpay import
// planner, slice I3a) can use them and cannot reach a write: `lib/data/payables.ts` imports the database and
// re-exports these (review I3a round 1).

import { PAYABLE_KINDS, REFERENCE_MAX, SOURCE_URL_MAX, USD_CENTS_MAX, type PayableKind } from "./payable-rules.ts";
import { hasInvisible, hasOtherSpace, isPlainText } from "./text.ts";

export interface PayableInput {
  orgId: string;
  recipientId: string;
  kind: PayableKind;
  usdCents: number;
  reference: string;
  sourceUrl?: string;
}

export type PayableProblemCode = "usd_invalid" | "reference_invalid" | "recipient_unknown" | "source_invalid" | "kind_invalid";
export interface PayableProblem {
  code: PayableProblemCode;
  field: "usdCents" | "reference" | "recipientId" | "sourceUrl" | "kind";
  detail: string;
}

// The invisible-character and other-space rules live in text.ts (shared with names and memos since slice H7).

function referenceProblem(r: string): string | undefined {
  if (!isPlainText(r, 1, REFERENCE_MAX) || r.trim() === "") return `reference must be 1–${REFERENCE_MAX} characters of plain text, not only spaces`;
  if (r !== r.trim()) return "reference must not start or end with whitespace (it becomes the memo exactly as written)";
  if (hasInvisible(r)) return "reference must not contain invisible characters (zero-width characters, bidirectional controls, soft hyphens, variation selectors, control characters): the memo must read as it looks";
  if (hasOtherSpace(r)) return "reference may use only the ordinary space (a no-break or other space looks the same but is a different memo)";
  if (r !== r.normalize("NFC")) return "reference must be in Unicode NFC (the same text written another way would look like a second payable with the same reference)";
  return undefined;
}

function sourceProblem(s: string): string | undefined {
  const rule = `source link must be an absolute https:// or http:// URL of at most ${SOURCE_URL_MAX} characters, without a user name or password`;
  // A literal lowercase prefix and no whitespace, so the database CHECK agrees with this rule exactly (WHATWG URL
  // would also accept "HTTPS://x" or "https:x", and strips surrounding spaces).
  if (s.length > SOURCE_URL_MAX || !/^https?:\/\/\S+$/.test(s) || !isPlainText(s, 1, SOURCE_URL_MAX) || hasInvisible(s)) return rule;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return rule;
  }
  if (url.username !== "" || url.password !== "") return rule;
  return undefined;
}

/** Every value problem of `input`, the recipient's existence aside (that needs the database). */
export function payableProblems(input: Omit<PayableInput, "orgId">): PayableProblem[] {
  const problems: PayableProblem[] = [];
  if (!PAYABLE_KINDS.includes(input.kind)) problems.push({ code: "kind_invalid", field: "kind", detail: `kind must be one of ${PAYABLE_KINDS.join(", ")}` });
  if (!Number.isSafeInteger(input.usdCents) || input.usdCents < 1 || input.usdCents > USD_CENTS_MAX) {
    problems.push({ code: "usd_invalid", field: "usdCents", detail: `the amount must be whole US cents from 1 to ${USD_CENTS_MAX} ($0.01 to $999,999.99)` });
  }
  const r = referenceProblem(input.reference);
  if (r) problems.push({ code: "reference_invalid", field: "reference", detail: r });
  if (input.sourceUrl !== undefined) {
    const s = sourceProblem(input.sourceUrl);
    if (s) problems.push({ code: "source_invalid", field: "sourceUrl", detail: s });
  }
  return problems;
}

