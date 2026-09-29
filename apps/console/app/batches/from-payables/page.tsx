import Link from "next/link";
import { disclosedReceivers, disclosersOf } from "../../../lib/data/linkability.ts";
import { payableHolders } from "../../../lib/data/payable-status.ts";
import { listPayables } from "../../../lib/data/payables.ts";
import { listRecipients } from "../../../lib/data/recipients.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { centsText, recipientLabel } from "../../../lib/view/format.ts";
import { disclosedText } from "../../../lib/view/linkability.ts";
import { LinkabilityNote } from "../../components/linkability.tsx";
import { AccessNotice } from "../../components/panels.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { FromPayablesForm } from "./from-payables-form.tsx";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { milestone: "Milestone", invoice: "Invoice", bounty: "Bounty", salary: "Salary" };

/** Choose free payables and make a batch from them at today's rate (slice H5b; REQ-CON-4; 04 FLOW-1 step 2). */
export default async function FromPayablesPage() {
  const { config, db } = serverContext();
  const [payables, recipients, holders] = await Promise.all([listPayables(db, config.orgId), listRecipients(db, config.orgId), payableHolders(db, config.orgId)]);
  const who = new Map(recipients.map((r) => [r.id, recipientLabel(r.displayName, r.address)]));
  // REQ-CON-6 (slice H6): a payable whose recipient's address a receipt already disclosed.
  const disclosed = await disclosedReceivers(db, config.orgId);
  const warnFor = new Map(recipients.map((r) => [r.id, disclosersOf(disclosed, r.address, r.network)]));
  // Only free payables: one held by a batch cannot be chosen again (H5a), and the payables page says where it is.
  const choices = payables.filter((p) => !holders.has(p.id)).map((p) => {
    const d = warnFor.get(p.recipientId) ?? [];
    return { id: p.id, reference: p.reference, recipient: who.get(p.recipientId) ?? "", kind: KIND[p.kind], dollars: centsText(p.usdCents), ...(d.length ? { warning: disclosedText(d.map((x) => x.title)) } : {}) };
  });
  return (
    <>
      <AccessNotice />
      <PageHeader eyebrow="Payouts" title="New batch from payables" description={<>Each chosen payable becomes a line: its recipient&apos;s address, its reference as the memo, and its dollars converted to ZEC at one quoted rate.</>} />
      {choices.length === 0 ? (
        <p className="card text-sm text-muted">
          No payables to pay. Every payable is in a batch, or none exist yet. <Link href="/payables" className="link">Go to payables</Link>
        </p>
      ) : (
        <>
          <FromPayablesForm choices={choices} />
          {choices.some((c) => c.warning) && <LinkabilityNote />}
        </>
      )}
    </>
  );
}
