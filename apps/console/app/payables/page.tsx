import Link from "next/link";
import { listPayables, PAYABLE_KINDS, type PayableKind } from "../../lib/data/payables.ts";
import { listRecipients } from "../../lib/data/recipients.ts";
import { serverContext } from "../../lib/server/context.ts";
import { centsText } from "../../lib/view/format.ts";
import { AccessNotice } from "../components/panels.tsx";
import { PayableForm } from "./payable-form.tsx";

export const dynamic = "force-dynamic";

const KIND: Record<PayableKind, { one: string; many: string }> = {
  milestone: { one: "Milestone", many: "Milestones" },
  invoice: { one: "Invoice", many: "Invoices" },
  bounty: { one: "Bounty", many: "Bounties" },
  salary: { one: "Salary", many: "Salaries" },
};
const isKind = (k: unknown): k is PayableKind => typeof k === "string" && (PAYABLE_KINDS as readonly string[]).includes(k);

/** The link's host as its text: where it goes, readable (IDN hosts show as punycode, so they cannot pass for another). */
const hostOf = (url: string) => new URL(url).host;

/** What the org owes (slice H4; REQ-CON-3; 04 SCR-3): the list, a kind filter (links, no JavaScript) and the add form. */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { config, db } = serverContext();
  const kind = (await searchParams).kind;
  const filter = isKind(kind) ? kind : undefined;
  const [all, recipients] = await Promise.all([listPayables(db, config.orgId), listRecipients(db, config.orgId)]);
  const list = filter ? all.filter((p) => p.kind === filter) : all;
  const names = new Map(recipients.map((r) => [r.id, r.displayName]));
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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Payables</h1>
        <p className="text-sm text-slate-500">What this org owes, in US dollars. Each reference becomes its payment&apos;s memo, so it is unique.</p>
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
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Payables{filter ? `: ${KIND[filter].many}` : ""}</caption>
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2">Reference</th>
              <th className="py-2">Recipient</th>
              <th className="py-2">Kind</th>
              <th className="py-2 pr-6 text-right">Amount</th>
              <th className="py-2">Source</th>
              <th className="py-2">Created (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 align-top">
                <td className="py-2">
                  <code>{p.reference}</code>
                </td>
                <td className="py-2">{names.get(p.recipientId)}</td>
                <td className="py-2">{KIND[p.kind].one}</td>
                <td className="py-2 pr-6 text-right tabular-nums">{centsText(p.usdCents)}</td>
                <td className="py-2">
                  {p.sourceUrl ? (
                    <a href={p.sourceUrl} rel="noopener noreferrer" className="text-sky-700 underline">
                      {hostOf(p.sourceUrl)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 tabular-nums">{p.createdAt.slice(0, 10)}</td>
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
        <PayableForm recipients={recipients.map((r) => ({ id: r.id, name: r.displayName }))} />
      )}
    </>
  );
}
