// The zecpay import, pure part (REQ-CON-19; `05` §3.6; slice I3a): a payroll CSV as zecpay reads it,
// `name,wallet,amount,currency,payout_currency` (Spider333/zecpay `lib/csv-parser.ts`, R112), planned as payables for a
// preview. Nothing here writes: the plan says, for every row, the payable it would become (its recipient matched by
// Orchard receiver or new, its reference) or why it is refused, by source line. Slice I3b previews it and writes it on
// an explicit confirm, in one transaction.

import { checkUnifiedAddress, orchardReceiverHex } from "../execution/address.ts";
import type { Network } from "../execution/types.ts";
import type { PayableKind } from "../data/payable-rules.ts";
import { payableProblems } from "../data/payable-validate.ts";
import { canonicalAddress, recipientProblems } from "../data/recipient-validate.ts";
import { IMPORT_MAX_ROWS, type ImportRefusal } from "./konclave.ts";

export interface ZecpayRow {
  sourceLine: number;
  name: string;
  wallet: string;
  amount: string;
  currency: string;
  payoutCurrency: string;
}

export interface ZecpayParse {
  rows: ZecpayRow[];
  /** A file-level problem (no header, missing columns): nothing can be planned. */
  fileProblem?: string;
}

/** Rows as zecpay reads them: a header row required, columns by name (trimmed, case-insensitive), every comma a split. */
export function parseZecpayCsv(text: string): ZecpayParse {
  const lines = text.split(/\r?\n/).map((row, i) => ({ sourceLine: i + 1, row })).filter((r) => r.row.trim() !== "");
  if (lines.length === 0) return { rows: [], fileProblem: "the file is empty" };
  const header = lines[0].row.toLowerCase().split(",").map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);
  const [nameAt, walletAt, amountAt, currencyAt, payoutAt] = ["name", "wallet", "amount", "currency", "payout_currency"].map(at);
  if (nameAt === -1 || walletAt === -1 || amountAt === -1) {
    return { rows: [], fileProblem: "the first row must be zecpay's header, naming at least name, wallet and amount" };
  }
  const cell = (cols: string[], i: number) => (i === -1 ? "" : (cols[i] ?? ""));
  const rows = lines.slice(1).map(({ sourceLine, row }) => {
    const cols = row.split(",").map((c) => c.trim());
    return { sourceLine, name: cell(cols, nameAt), wallet: cell(cols, walletAt), amount: cell(cols, amountAt), currency: cell(cols, currencyAt), payoutCurrency: cell(cols, payoutAt) };
  });
  return { rows };
}

/** Whole US cents from a dollar amount (`500`, `227.5`, `227.50`), or undefined: stricter than zecpay's `parseFloat`. */
export function dollarsToCents(amount: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export type PlannedRecipient = { kind: "existing"; id: string; name: string; fileName: string } | { kind: "new"; name: string; fileName: string };

export interface PlannedPayable {
  sourceLine: number;
  address: string;
  usdCents: number;
  reference: string;
  recipient: PlannedRecipient;
}

export interface ZecpayPlan {
  payables: PlannedPayable[];
  refused: ImportRefusal[];
  fileProblem?: string;
}

export interface PlanContext {
  network: Network;
  kind: PayableKind;
  /** The operator's prefix; each reference is `<prefix>-<source line>`. */
  prefix: string;
  /** The org's recipients on this network. */
  recipients: readonly { id: string; displayName: string; address: string; network: Network }[];
  /** References the org already holds. */
  takenReferences: ReadonlySet<string>;
}

/**
 * The plan for a parsed file (`05` §3.6). Each row is checked in the spec's order, so it gives one reason: currency,
 * payout, amount, address; then its recipient is matched by Orchard receiver (else new, which needs a valid name) and
 * its reference made from the prefix (refused when the org already holds it). At most 50 payables.
 */
export function planZecpayImport(parsed: ZecpayParse, ctx: PlanContext): ZecpayPlan {
  if (parsed.fileProblem) return { payables: [], refused: [], fileProblem: parsed.fileProblem };
  const prefix = ctx.prefix.trim();
  const prefixProblem = payableProblems({ recipientId: "-", kind: ctx.kind, usdCents: 1, reference: `${prefix}-1` }).find((p) => p.field === "reference" || p.field === "kind");
  if (!prefix || prefixProblem) return { payables: [], refused: [], fileProblem: prefix ? `the reference prefix cannot make a valid reference: ${prefixProblem!.detail}` : "give a reference prefix: zecpay rows have no reference, and each payable needs one" };

  const byReceiver = new Map<string, { id: string; displayName: string }>();
  for (const r of ctx.recipients) {
    if (r.network !== ctx.network) continue;
    const key = orchardReceiverHex(r.address, r.network);
    if (key && !byReceiver.has(key)) byReceiver.set(key, r);
  }
  const plan: ZecpayPlan = { payables: [], refused: [] };
  const newNames = new Map<string, string>(); // receiver → the name a new recipient gets (the file's first)
  for (const row of parsed.rows) {
    const refuse = (reason: string) => plan.refused.push({ sourceLine: row.sourceLine, reason });
    const currency = (row.currency || "USD").toUpperCase();
    const payout = (row.payoutCurrency || "ZEC").toUpperCase();
    if (currency === "ZEC") {
      refuse("the amount is in ZEC: a ZEC amount belongs in a draft batch (use the Konclave format there)");
      continue;
    }
    if (currency !== "USD") {
      refuse(`currency must be USD or ZEC, not '${row.currency}'`);
      continue;
    }
    if (payout !== "ZEC") {
      refuse(`the console pays only ZEC, not '${row.payoutCurrency}'`);
      continue;
    }
    const cents = dollarsToCents(row.amount);
    if (cents === undefined || cents === 0) {
      refuse(`invalid amount '${row.amount}': whole cents greater than zero, like 500 or 227.50`);
      continue;
    }
    // One case, lower-cased, as the recipient form stores it (Bech32 allows all upper case).
    const wallet = canonicalAddress(row.wallet);
    if (wallet === undefined) {
      refuse("not an address this console pays: the address mixes upper and lower case (a unified address is all one case)");
      continue;
    }
    const check = checkUnifiedAddress(wallet, ctx.network);
    if (!check.ok) {
      refuse(`not an address this console pays: ${check.detail}`);
      continue;
    }
    const receiver = orchardReceiverHex(wallet, ctx.network)!;
    const existing = byReceiver.get(receiver);
    let recipient: PlannedRecipient;
    if (existing) {
      recipient = { kind: "existing", id: existing.id, name: existing.displayName, fileName: row.name };
    } else {
      const name = newNames.get(receiver) ?? row.name;
      const bad = recipientProblems({ orgId: "-", network: ctx.network, displayName: name, address: wallet }).find((p) => p.field === "displayName");
      if (bad) {
        refuse(`a new recipient needs a name: ${bad.detail}`);
        continue;
      }
      recipient = { kind: "new", name, fileName: row.name };
    }
    const reference = `${prefix}-${row.sourceLine}`;
    if (ctx.takenReferences.has(reference)) {
      refuse(`reference taken: ${reference} is already a payable's reference`);
      continue;
    }
    const problems = payableProblems({ recipientId: "-", kind: ctx.kind, usdCents: cents, reference });
    const usd = problems.find((p) => p.field === "usdCents");
    if (usd) {
      refuse(`invalid amount '${row.amount}': ${usd.detail}`);
      continue;
    }
    // Each row's own reference (review I3a round 1): a long prefix can pass with line 1 and overflow with line 10.
    const ref = problems.find((p) => p.field === "reference");
    if (ref) {
      refuse(`reference not valid: ${reference}: ${ref.detail}`);
      continue;
    }
    if (plan.payables.length >= IMPORT_MAX_ROWS) {
      refuse(`an import holds at most ${IMPORT_MAX_ROWS} payables`);
      continue;
    }
    if (recipient.kind === "new") newNames.set(receiver, recipient.name); // only an accepted row names the new recipient
    plan.payables.push({ sourceLine: row.sourceLine, address: wallet, usdCents: cents, reference, recipient });
  }
  return plan;
}
