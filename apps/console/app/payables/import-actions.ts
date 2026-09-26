"use server";

// The zecpay import (slice I3b; REQ-CON-19; 05 §3.6): Preview plans the file and writes nothing; Import writes the
// previewed plan in one transaction, or nothing when the data changed since (preview again). Unbound: (prev, form).

import { redirect } from "next/navigation";
import { ImportEmptyError, ImportPlanChangedError, previewZecpayImport, writeZecpayImport } from "../../lib/data/payable-import.ts";
import { PAYABLE_KINDS, type PayableKind } from "../../lib/data/payable-rules.ts";
import { serverContext } from "../../lib/server/context.ts";
import { previewRows, refusalLines, type ZecpayImportState } from "../../lib/view/zecpay-import.ts";

export async function importZecpayAction(prev: ZecpayImportState, form: FormData): Promise<ZecpayImportState> {
  const csv = String(form.get("csv") ?? "");
  const prefix = String(form.get("prefix") ?? "");
  const rawKind = String(form.get("kind") ?? "salary");
  const base = { submission: prev.submission + 1, csv, prefix, kind: rawKind, rows: [], refused: [] };
  if (!(PAYABLE_KINDS as readonly string[]).includes(rawKind)) return { ...base, message: `kind must be one of ${PAYABLE_KINDS.join(", ")}` };
  const { config, db } = serverContext();
  const input = { orgId: config.orgId, network: config.network, kind: rawKind as PayableKind, prefix, csv };
  const preview = async (message?: string): Promise<ZecpayImportState> => {
    const { plan, fingerprint } = await previewZecpayImport(db, input);
    return { ...base, fingerprint: plan.fileProblem ? undefined : fingerprint, rows: previewRows(plan), refused: refusalLines(plan), message: message ?? plan.fileProblem };
  };
  if (form.get("intent") !== "confirm") return preview();
  let written: { recipients: number; payables: number };
  try {
    written = await writeZecpayImport(db, input, String(form.get("fingerprint") ?? ""));
  } catch (e) {
    if (e instanceof ImportPlanChangedError) return preview(e.message);
    if (e instanceof ImportEmptyError) return preview(e.message);
    throw e;
  }
  // Outside any try: redirect throws. 303 for a no-JS post, a client navigation otherwise.
  redirect(`/payables?imported=${written.payables}&newRecipients=${written.recipients}`);
}
