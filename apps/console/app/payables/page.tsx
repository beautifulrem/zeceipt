import Link from "next/link";
import { payableHolders } from "../../lib/data/payable-status.ts";
import { listPayables, PAYABLE_KINDS, type PayableKind } from "../../lib/data/payables.ts";
import { listRecipients } from "../../lib/data/recipients.ts";
import { serverContext } from "../../lib/server/context.ts";
import { centsText, recipientLabel, shortAddress } from "../../lib/view/format.ts";
import { TableCard } from "../components/table-card.tsx";
import { Words } from "../components/words.tsx";
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
      <Link href={k ? `/payables?kind=${k}` : "/payables"} aria-current={k === filter ? "page" : undefined} className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[0.8125rem] font-medium transition-colors sm:px-3 sm:text-sm ${k === filter ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-2 hover:text-fg"}`}>
        {label}
      </Link>
    </li>
  );
  return (
    <>
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
        <ul className="scroll-shadows inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-line p-1 shadow-card sm:gap-1">
          {tab(undefined, "All")}
          {PAYABLE_KINDS.map((k) => tab(k, KIND[k].many))}
        </ul>
      </nav>
      {list.length === 0 ? (
        <p className="card text-sm text-muted">{filter ? `No ${KIND[filter].one.toLowerCase()} payables.` : "No payables yet."}</p>
      ) : (
        <TableCard label="Payables">
        <table className={TABLE_CLASS}>
          <caption className="sr-only">Payables{filter ? `: ${KIND[filter].many}` : ""}</caption>
          <thead>
            <tr>
              <th>Reference</th>
              <th className="hidden md:table-cell">Recipient</th>
              <th className="hidden sm:table-cell">Kind</th>
              <th className="hidden text-right sm:table-cell">Amount</th>
              <th className="hidden 2xl:table-cell">Source</th>
              <th className="hidden md:table-cell">Created (UTC)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>
                    <Words text={p.reference} />
                  </code>
                  {/* On a phone the recipient and the amount sit under the reference (review F round 3). */}
                  <div className="mt-0.5 text-xs text-muted md:hidden">
                    {byId.get(p.recipientId)?.displayName}
                    <span className="sm:hidden"> · {centsText(p.usdCents)}</span>
                    {holders.has(p.id) && <span className="block truncate sm:hidden">in {holders.get(p.id)!.title}</span>}
                  </div>
                  {p.sourceUrl && (
                    <div className="max-w-[9rem] truncate 2xl:hidden">
                      <a href={p.sourceUrl} rel="noopener noreferrer" className="link text-xs">
                        {hostOf(p.sourceUrl)}
                      </a>
                    </div>
                  )}
                </td>
                <td className="hidden md:table-cell">
                  {byId.get(p.recipientId)?.displayName}
                  {/* Names need not be unique: the address prefix tells two "Alice"s apart (review H4). */}
                  <div className="max-w-[11rem] truncate font-mono text-xs text-muted">{shortAddress(byId.get(p.recipientId)?.address ?? "")}</div>
                </td>
                <td className="hidden sm:table-cell">
                  <span className="badge badge-plain">{KIND[p.kind].one}</span>
                </td>
                <td className="hidden text-right tabular-nums sm:table-cell">{centsText(p.usdCents)}</td>
                <td className="hidden 2xl:table-cell">
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} rel="noopener noreferrer" className="link">
                      {hostOf(p.sourceUrl)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="hidden whitespace-nowrap tabular-nums md:table-cell">{p.createdAt.slice(0, 10)}</td>
                <td>
                  {/* Derived from the batch lines (H3.1.6, H5b.1.6); whether that batch paid is on its own page. */}
                  {holders.has(p.id) ? (
                    <Link href={`/batches/${holders.get(p.id)!.batchId}`} title={`In batch ${holders.get(p.id)!.title}`} className="badge badge-compact tone-info badge-plain max-w-[8rem] no-underline hover:border-info sm:max-w-[12rem]">
                      <span className="truncate">
                        In batch<span className="hidden sm:inline"> {holders.get(p.id)!.title}</span>
                      </span>
                    </Link>
                  ) : (
                    <span className="badge badge-compact tone-neutral">Unbatched</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableCard>
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
