import Link from "next/link";
import { payableHolders } from "../../../lib/data/payable-status.ts";
import { listPayables } from "../../../lib/data/payables.ts";
import { listRecipients } from "../../../lib/data/recipients.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { centsText, recipientLabel } from "../../../lib/view/format.ts";
import { AccessNotice } from "../../components/panels.tsx";
import { FromPayablesForm } from "./from-payables-form.tsx";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { milestone: "Milestone", invoice: "Invoice", bounty: "Bounty", salary: "Salary" };

/** Choose free payables and make a batch from them at today's rate (slice H5b; REQ-CON-4; 04 FLOW-1 step 2). */
export default async function FromPayablesPage() {
  const { config, db } = serverContext();
  const [payables, recipients, holders] = await Promise.all([listPayables(db, config.orgId), listRecipients(db, config.orgId), payableHolders(db, config.orgId)]);
  const who = new Map(recipients.map((r) => [r.id, recipientLabel(r.displayName, r.address)]));
  // Only free payables: one held by a batch cannot be chosen again (H5a), and the payables page says where it is.
  const choices = payables.filter((p) => !holders.has(p.id)).map((p) => ({ id: p.id, reference: p.reference, recipient: who.get(p.recipientId) ?? "", kind: KIND[p.kind], dollars: centsText(p.usdCents) }));
  return (
    <>
      <AccessNotice />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">New batch from payables</h1>
        <p className="text-sm text-slate-500">Each chosen payable becomes a line: its recipient&apos;s address, its reference as the memo, and its dollars converted to ZEC at one quoted rate.</p>
      </header>
      {choices.length === 0 ? (
        <p className="rounded-lg border border-slate-200 p-4 text-sm">
          No payables to pay. Every payable is in a batch, or none exist yet. <Link href="/payables" className="text-sky-700 underline">Go to payables</Link>
        </p>
      ) : (
        <FromPayablesForm choices={choices} />
      )}
    </>
  );
}
