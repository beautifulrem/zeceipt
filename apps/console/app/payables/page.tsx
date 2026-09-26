import Link from "next/link";
import { payableHolders } from "../../lib/data/payable-status.ts";
import { listPayables, PAYABLE_KINDS, type PayableKind } from "../../lib/data/payables.ts";
import { listRecipients } from "../../lib/data/recipients.ts";
import { serverContext } from "../../lib/server/context.ts";
import { centsText, recipientLabel, shortAddress } from "../../lib/view/format.ts";
import { AccessNotice } from "../components/panels.tsx";
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
  const params = await searchParams;
  const kind = params.kind;
  // Slice I3b: after an import, what it added (from the redirect's query; numbers only).
  const imported = typeof params.imported === "string" && /^\d{1,3}$/.test(params.imported) ? Number(params.imported) : undefined;
  const newRecipients = typeof params.newRecipients === "string" && /^\d{1,3}$/.test(params.newRecipients) ? Number(params.newRecipients) : 0;
  const filter = isKind(kind) ? kind : undefined;
  const [all, recipients, holders] = await Promise.all([listPayables(db, config.orgId), listRecipients(db, config.orgId), payableHolders(db, config.orgId)]);
  const list = filter ? all.filter((p) => p.kind === filter) : all;
  const byId = new Map(recipients.map((r) => [r.id, r]));
  const tab = (k: PayableKind | undefined, label: string) => (
    <li key={k ?? "all"}>
      <Link href={k ? `/payables?kind=${k}` : "/payables"} aria-current={k === filter ? "page" : undefined} className={k === filter ? "font-semibold text-slate-900" : "text-sky-700 underline"}>
        {label}
      </Link>
    </li>
  );
  return (
    <>
      <AccessNotice />
      {imported !== undefined && (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          Imported {imported} {imported === 1 ? "payable" : "payables"}
          {newRecipients > 0 ? ` and ${newRecipients} new ${newRecipients === 1 ? "recipient" : "recipients"}` : ""} from the zecpay CSV.
        </p>
      )}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Payables</h1>
        <p className="text-sm text-slate-500">What this org owes, in US dollars. Each reference becomes its payment&apos;s memo, so it is unique.</p>
        <p className="text-sm">
          <Link href="/batches/from-payables" className="text-sky-700 underline">
            Make a batch from payables
          </Link>
        </p>
      </header>
      <nav aria-label="Filter by kind">
        <ul className="flex gap-3 text-sm">
          {tab(undefined, "All")}
          {PAYABLE_KINDS.map((k) => tab(k, KIND[k].many))}
        </ul>
      </nav>
      {list.length === 0 ? (
        <p className="text-sm">{filter ? `No ${KIND[filter].one.toLowerCase()} payables.` : "No payables yet."}</p>
      ) : (
        <table className={TABLE_CLASS}>
          <caption className="sr-only">Payables{filter ? `: ${KIND[filter].many}` : ""}</caption>
          <thead className="border-b border-slate-200 text-slate-500">
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
              <tr key={p.id} className="border-b border-slate-100 align-top">
                <td>
                  <code>{p.reference}</code>
                </td>
                <td>
                  {byId.get(p.recipientId)?.displayName}
                  {/* Names need not be unique: the address prefix tells two "Alice"s apart (review H4). */}
                  <div className="font-mono text-xs text-slate-500">{shortAddress(byId.get(p.recipientId)?.address ?? "")}</div>
                </td>
                <td>{KIND[p.kind].one}</td>
                <td className="text-right tabular-nums">{centsText(p.usdCents)}</td>
                <td>
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} rel="noopener noreferrer" className="text-sky-700 underline">
                      {hostOf(p.sourceUrl)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="tabular-nums">{p.createdAt.slice(0, 10)}</td>
                <td>
                  {/* Derived from the batch lines (H3.1.6, H5b.1.6); whether that batch paid is on its own page. */}
                  {holders.has(p.id) ? (
                    <Link href={`/batches/${holders.get(p.id)!.batchId}`} className="text-sky-700 underline">
                      In batch {holders.get(p.id)!.title}
                    </Link>
                  ) : (
                    "Free"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {recipients.length === 0 ? (
        <p className="rounded-lg border border-slate-200 p-4 text-sm">
          Add a recipient first: a payable is owed to one. <Link href="/recipients" className="text-sky-700 underline">Go to recipients</Link>
        </p>
      ) : (
        <PayableForm recipients={recipients.map((r) => ({ id: r.id, label: recipientLabel(r.displayName, r.address) }))} />
      )}
      <ImportForm />
    </>
  );
}
