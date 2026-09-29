import Link from "next/link";
import { Layers, ListPlus, Plus } from "lucide-react";
import { isSubmitted, listBatches } from "../lib/data/batches.ts";
import { receiptCounts } from "../lib/data/receipts.ts";
import { batchStage } from "../lib/view/stage.ts";
import { StatusBadge } from "./components/status.tsx";
import { serverContext } from "../lib/server/context.ts";
import { paymentMode } from "../lib/view/mode.ts";
import { ZecAmount } from "./components/amount.tsx";
import { AccessNotice, ModePanel } from "./components/panels.tsx";
import { PageHeader } from "./components/page-header.tsx";
import { TABLE_CLASS } from "../lib/view/table.ts";

// Read per request through the library (Next's data-access-layer guidance; never fetch our own API).
export const dynamic = "force-dynamic";

export default async function Home() {
  const { config, db } = serverContext();
  const batches = await listBatches(db, config.orgId);
  // The stage column (slice F4): the console's own records, so the list never waits on the wallet.
  const counts = await receiptCounts(db, config.orgId);
  const stages = new Map(await Promise.all(batches.map(async (b) => [b.id, batchStage({ voided: b.voided, submitted: await isSubmitted(db, { orgId: config.orgId, id: b.id }), receipts: counts.get(b.id) ?? 0, items: b.itemCount })] as const)));
  return (
    <>
      <AccessNotice />
      <PageHeader
        eyebrow="Payouts"
        title="Batches"
        description="Each batch pays its lines in one shielded transaction, then issues a receipt per line that its recipient can verify."
        actions={
          <>
            <Link href="/batches/from-payables" className="btn btn-secondary" aria-label="New batch from payables">
              <ListPlus aria-hidden="true" strokeWidth={1.75} />
              From payables
            </Link>
            <Link href="/batches/new" className="btn btn-primary">
              <Plus aria-hidden="true" strokeWidth={2} />
              New batch
            </Link>
          </>
        }
      />
      <div className="animate-rise-2">
        <ModePanel mode={paymentMode(config)} />
      </div>
      {batches.length === 0 ? (
        <div className="card animate-rise-3 flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-strong">
            <Layers aria-hidden="true" strokeWidth={1.75} />
          </span>
          <p className="font-medium">No batches yet. Create one with New batch.</p>
          <p className="max-w-md text-sm text-muted">Start from payables to convert US dollars at one locked rate, or type the lines yourself.</p>
        </div>
      ) : (
        <div className="table-card animate-rise-3">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">Batches, newest first</caption>
            <thead>
              <tr>
                <th>Title</th>
                <th>Stage</th>
                <th className="hidden sm:table-cell">Created</th>
                <th className="text-right">Items</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="row-link">
                  <td>
                    <Link href={`/batches/${b.id}`} className="link font-medium">
                      {b.title}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge view={stages.get(b.id)!} />
                  </td>
                  <td className="hidden whitespace-nowrap text-muted sm:table-cell">{b.createdAt.replace("T", " ").slice(0, 16)} UTC</td>
                  <td className="text-right tabular-nums">{b.itemCount}</td>
                  <td className="whitespace-nowrap text-right">
                    <ZecAmount zat={b.totalZat} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
