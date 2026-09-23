import Link from "next/link";
import { listBatches } from "../lib/data/batches.ts";
import { serverContext } from "../lib/server/context.ts";
import { paymentMode } from "../lib/view/mode.ts";
import { ZecAmount } from "./components/amount.tsx";
import { AccessNotice, ModePanel } from "./components/panels.tsx";

// Read per request through the library (Next's data-access-layer guidance; never fetch our own API).
export const dynamic = "force-dynamic";

export default async function Home() {
  const { config, db } = serverContext();
  const batches = await listBatches(db, config.orgId);
  return (
    <>
      <AccessNotice />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Batches</h1>
        <Link href="/batches/new" className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white">
          New batch
        </Link>
      </div>
      <ModePanel mode={paymentMode(config)} />
      {batches.length === 0 ? (
        <p className="text-slate-600">No batches yet. Create one with New batch.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Batches, newest first</caption>
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2">Title</th>
              <th>Created</th>
              <th className="text-right">Items</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-b border-slate-100">
                <td className="py-2">
                  <Link href={`/batches/${b.id}`} className="text-sky-700 underline">
                    {b.title}
                  </Link>
                </td>
                <td>{b.createdAt.replace("T", " ").slice(0, 16)} UTC</td>
                <td className="text-right">{b.itemCount}</td>
                <td className="text-right">
                  <ZecAmount zat={b.totalZat} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
