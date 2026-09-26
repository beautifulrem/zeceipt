// The zecpay import's write (REQ-CON-19; `05` §3.6; slice I3b). Payables and recipients are permanent records (no
// route edits or deletes them), so the import writes only what the operator saw: the preview carries a fingerprint of
// its plan, and the confirm re-plans from the same CSV inside one immediate transaction, from fresh reads, and writes
// only if the plan is unchanged: every accepted row (new recipients once per receiver, then the payables) or none.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ConsoleDb } from "../../db/client.ts";
import { runSync } from "../../db/errors.ts";
import { payables, recipients } from "../../db/schema.ts";
import { orchardReceiverHex } from "../execution/address.ts";
import { ExecutionError, type Network } from "../execution/types.ts";
import { parseZecpayCsv, planZecpayImport, type ZecpayPlan } from "../import/zecpay.ts";
import { newUuidV7 } from "./batches.ts";
import type { PayableKind } from "./payable-rules.ts";

export interface ZecpayImportInput {
  orgId: string;
  network: Network;
  kind: PayableKind;
  prefix: string;
  csv: string;
}

type Db = Pick<ConsoleDb, "select">;

function readContext(db: Db, input: ZecpayImportInput) {
  const rows = db.select({ id: recipients.id, displayName: recipients.displayName, address: recipients.address, network: recipients.network }).from(recipients).where(eq(recipients.orgId, input.orgId)).all();
  const refs = db.select({ reference: payables.reference }).from(payables).where(eq(payables.orgId, input.orgId)).all();
  return { network: input.network, kind: input.kind, prefix: input.prefix, recipients: rows, takenReferences: new Set(refs.map((r) => r.reference)) };
}

/** What the preview showed, as one hash: the rows to write and the rows refused. */
export function planFingerprint(plan: ZecpayPlan): string {
  return createHash("sha256").update(JSON.stringify({ payables: plan.payables, refused: plan.refused, fileProblem: plan.fileProblem ?? null })).digest("hex");
}

/** The plan for a preview, from the organisation's recipients and references now. Writes nothing. */
export function previewZecpayImport(db: ConsoleDb, input: ZecpayImportInput): Promise<{ plan: ZecpayPlan; fingerprint: string }> {
  return runSync(() => {
    const plan = planZecpayImport(parseZecpayCsv(input.csv), readContext(db, input));
    return { plan, fingerprint: planFingerprint(plan) };
  });
}

/** The data changed between the preview and the confirm (a reference taken, a recipient added): nothing was written. */
export class ImportPlanChangedError extends ExecutionError {
  constructor() {
    super("import_plan_changed", "the recipients or payables changed since the preview; nothing was imported; preview again");
  }
}

/** The plan has nothing to write (a file problem, or every row refused). */
export class ImportEmptyError extends ExecutionError {
  constructor(detail: string) {
    super("import_empty", detail);
  }
}

/**
 * Write the previewed plan, if it is still the plan: one immediate transaction that re-plans from fresh reads, compares
 * the fingerprint, then inserts each new recipient once (per Orchard receiver) and every payable. Any failure rolls
 * everything back. Returns what was written.
 */
export function writeZecpayImport(
  db: ConsoleDb,
  input: ZecpayImportInput,
  fingerprint: string,
  opts: { now?: () => Date; newId?: () => string } = {},
): Promise<{ recipients: number; payables: number; plan: ZecpayPlan }> {
  const now = (opts.now ?? (() => new Date()))();
  const newId = opts.newId ?? (() => newUuidV7(now.getTime()));
  return runSync(() =>
    db.transaction(
      (tx) => {
        const plan = planZecpayImport(parseZecpayCsv(input.csv), readContext(tx, input));
        if (planFingerprint(plan) !== fingerprint) throw new ImportPlanChangedError();
        if (plan.fileProblem) throw new ImportEmptyError(plan.fileProblem);
        if (plan.payables.length === 0) throw new ImportEmptyError("no row can be imported; nothing was written");
        const at = now.toISOString();
        const created = new Map<string, string>(); // Orchard receiver → the new recipient's id
        for (const p of plan.payables) {
          let recipientId: string;
          if (p.recipient.kind === "existing") {
            recipientId = p.recipient.id;
          } else {
            const receiver = orchardReceiverHex(p.address, input.network)!;
            const known = created.get(receiver);
            if (known) {
              recipientId = known;
            } else {
              recipientId = newId();
              tx.insert(recipients).values({ orgId: input.orgId, id: recipientId, displayName: p.recipient.name, address: p.address, network: input.network, kycStatus: "unknown", taxFlag: "none", settlementPref: "zec", notes: "", createdAt: at, updatedAt: at }).run();
              created.set(receiver, recipientId);
            }
          }
          tx.insert(payables).values({ orgId: input.orgId, id: newId(), recipientId, kind: input.kind, usdCents: p.usdCents, reference: p.reference, sourceUrl: null, createdAt: at }).run();
        }
        return { recipients: created.size, payables: plan.payables.length, plan };
      },
      { behavior: "immediate" },
    ),
  );
}
