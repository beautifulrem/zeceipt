import Link from "next/link";
import { payableHolders } from "../../lib/data/payable-status.ts";
import { listPayables, PAYABLE_KINDS, type PayableKind } from "../../lib/data/payables.ts";
import { listRecipients } from "../../lib/data/recipients.ts";
import { serverContext } from "../../lib/server/context.ts";
import { centsText, recipientLabel, shortAddress } from "../../lib/view/format.ts";
import { AccessNotice } from "../components/panels.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ListPlus } from "lucide-react";
import { ImportForm } from "./import-form.tsx";
import { PayableForm } from "./payable-form.tsx";
import { TABLE_CLASS } from "../../lib/view/table.ts";

export const dynamic = "force-dynamic";

const KIND: Record<PayableKind, { one: string; many: string }> = {
  milestone: { one: "Milestone", many: "Milestones" },
  invoice: { one: "Invoice", many: "Invoices" },
  bounty: { one: "Bounty", many: "Bounties" },
  salary: { one: "Salary", many: "Salaries" },
};
const isKind = (k: unknown): k is PayableKind => typeof k === "string" && (PAYABLE_KINDS as readonly string[]).includes(k);

/**
 * The link's host as its text: where it goes, readable (IDN hosts show as punycode, so they cannot pass for another).
 * A stored link always parsed when written (H3); a raw-SQL row that passes the CHECK but not the parser shows as
 * written rather than failing the page (review H4's optional).
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What the org owes (slice H4; REQ-CON-3; 04 SCR-3): the list, a kind filter (links, no JavaScript) and the add form. */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { config, db } = serverContext();
  const kind = (await searchParams).kind;
  const filter = isKind(kind) ? kind : undefined;
  const [all, recipients, holders] = await Promise.all([listPayables(db, config.orgId), listRecipients(db, config.orgId), payableHolders(db, config.orgId)]);
  const list = filter ? all.filter((p) => p.kind === filter) : all;
  const byId = new Map(recipients.map((r) => [r.id, r]));
  const tab = (k: PayableKind | undefined, label: string) => (
    <li key={k ?? "all"}>
      <Link href={k ? `/payables?kind=${k}` : "/payables"} aria-current={k === filter ? "page" : undefined} className={`inline-flex rounded-full px-3 py-1 text-sm font-medium transition-colors ${k === filter ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-2 hover:text-fg"}`}>
        {label}
      </Link>
    </li>
  );
  return (
    <>
      <AccessNotice />
      <PageHeader
        eyebrow="Obligations"
        title="Payables"
        description={<>What this org owes, in US dollars. Each reference becomes its payment&apos;s memo, so it is unique.</>}
        actions={
          <Link href="/batches/from-payables" className="btn btn-primary">
            <ListPlus aria-hidden="true" strokeWidth={1.75} />
            Make a batch from payables
          </Link>
        }
      />
      <nav aria-label="Filter by kind">
        <ul className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1 shadow-card">
          {tab(undefined, "All")}
          {PAYABLE_KINDS.map((k) => tab(k, KIND[k].many))}
        </ul>
      </nav>
      {list.length === 0 ? (
        <p className="card text-sm text-muted">{filter ? `No ${KIND[filter].one.toLowerCase()} payables.` : "No payables yet."}</p>
      ) : (
        <div className="table-card">
        <table className={TABLE_CLASS}>
          <caption className="sr-only">Payables{filter ? `: ${KIND[filter].many}` : ""}</caption>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Recipient</th>
              <th>Kind</th>
              <th className="text-right">Amount</th>
              <th>Source</th>
              <th>Created (UTC)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">
                  <code>{p.reference}</code>
                </td>
                <td>
                  {byId.get(p.recipientId)?.displayName}
                  {/* Names need not be unique: the address prefix tells two "Alice"s apart (review H4). */}
                  <div className="font-mono text-xs text-muted">{shortAddress(byId.get(p.recipientId)?.address ?? "")}</div>
                </td>
                <td>
                  <span className="badge badge-plain">{KIND[p.kind].one}</span>
                </td>
                <td className="text-right tabular-nums">{centsText(p.usdCents)}</td>
                <td>
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} rel="noopener noreferrer" className="link">
                      {hostOf(p.sourceUrl)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap tabular-nums">{p.createdAt.slice(0, 10)}</td>
                <td>
                  {/* Derived from the batch lines (H3.1.6, H5b.1.6); whether that batch paid is on its own page. */}
                  {holders.has(p.id) ? (
                    <Link href={`/batches/${holders.get(p.id)!.batchId}`} className="badge tone-info badge-plain no-underline hover:border-info">
                      In batch {holders.get(p.id)!.title}
                    </Link>
                  ) : (
                    <span className="badge tone-neutral">Unbatched</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {recipients.length === 0 ? (
        <p className="card text-sm text-muted">
          Add a recipient first: a payable is owed to one. <Link href="/recipients" className="link">Go to recipients</Link>
        </p>
      ) : (
        <PayableForm recipients={recipients.map((r) => ({ id: r.id, label: recipientLabel(r.displayName, r.address) }))} />
      )}
      <ImportForm />
    </>
  );
}
