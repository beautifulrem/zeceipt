import { notFound } from "next/navigation";
import { getBatch } from "../../../lib/data/batches.ts";
import { listReceipts } from "../../../lib/data/receipts.ts";
import { getBatchStatus, type BatchStatus } from "../../../lib/data/status.ts";
import { ZkoolGraphqlError, ZkoolTransportError } from "../../../lib/execution/zkool-client.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { shortAddress, zecText } from "../../../lib/view/format.ts";
import { paymentMode } from "../../../lib/view/mode.ts";
import { STATUS_UNAVAILABLE, stateView } from "../../../lib/view/status.ts";
import { AccessNotice, ModePanel } from "../../components/panels.tsx";
import { Lifecycle, StatusBadge } from "../../components/status.tsx";

export const dynamic = "force-dynamic";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = serverContext();
  const rec = UUID_V7.test(id) ? await getBatch(ctx.db, ctx.config.orgId, id) : undefined;
  if (!rec) notFound();
  // The chain read can fail (wallet down): then claim nothing about the payment, and still show the rest.
  let status: BatchStatus | undefined;
  let unavailable = false;
  if (ctx.backend) {
    try {
      status = await getBatchStatus(ctx.db, ctx.backend, ctx.config.orgId, rec.id, { requiredConfirmations: ctx.config.confirmations });
    } catch (e) {
      if (!(e instanceof ZkoolTransportError || e instanceof ZkoolGraphqlError)) throw e;
      unavailable = true;
    }
  }
  const view = status ? stateView(status) : unavailable ? STATUS_UNAVAILABLE : undefined;
  const receipts = await listReceipts(ctx.db, ctx.keyring, ctx.config.orgId, rec.id);
  const total = rec.items.reduce((s, i) => s + i.zat, 0n);
  return (
    <>
      <AccessNotice />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{rec.title}</h1>
        <p className="text-sm text-slate-500">
          Batch <code>{rec.id}</code> · created {rec.createdAt.replace("T", " ").slice(0, 16)} UTC
        </p>
      </header>

      <ModePanel mode={paymentMode(ctx.config)} />

      <section aria-labelledby="status-heading" className="space-y-3 rounded-lg border border-slate-200 p-4">
        <h2 id="status-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Status
        </h2>
        {view && unavailable ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge view={view} />
              <span className="text-sm">
                <strong>Next:</strong> {view.next}
              </span>
            </div>
            <Lifecycle view={view} />
            <p className="text-sm">{view.explanation}</p>
          </>
        ) : view && status ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge view={view} />
              <span className="text-sm">
                <strong>Next:</strong> {view.next}
              </span>
            </div>
            <Lifecycle view={view} />
            <p className="text-sm">{view.explanation}</p>
            {(status.detail.txid || status.detail.error) && (
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
                {status.detail.txid && (
                  <>
                    <dt className="text-slate-500">Transaction</dt>
                    <dd>
                      <code className="break-all">{status.detail.txid}</code>
                    </dd>
                  </>
                )}
                {status.detail.confirmations !== undefined && (
                  <>
                    <dt className="text-slate-500">Confirmations</dt>
                    <dd>
                      {status.detail.confirmations} ({status.detail.required ?? ctx.config.confirmations} required)
                    </dd>
                  </>
                )}
                {status.detail.error && (
                  <>
                    <dt className="text-slate-500">Wallet said</dt>
                    <dd>{status.detail.error}</dd>
                  </>
                )}
              </dl>
            )}
          </>
        ) : (
          <p className="text-sm">External-signer custody: this console does not pay or track this batch.</p>
        )}
      </section>

      <section aria-labelledby="items-heading" className="space-y-2">
        <h2 id="items-heading" className="text-lg font-semibold">
          Items
        </h2>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Items of this batch</caption>
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2">Payable</th>
              <th>Payee</th>
              <th>Address</th>
              <th>Memo</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rec.items.map((i) => (
              <tr key={i.idx} className="border-b border-slate-100">
                <td className="py-2">{i.payableId}</td>
                <td>{i.label || "—"}</td>
                <td title={i.address}>
                  <code>{shortAddress(i.address)}</code>
                </td>
                <td>{i.memo}</td>
                <td className="text-right" title={`${i.zat} zatoshi`}>
                  {zecText(i.zat)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 text-right font-semibold">
                Total
              </td>
              <td className="text-right font-semibold" title={`${total} zatoshi`}>
                {zecText(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section aria-labelledby="receipts-heading" className="space-y-2">
        <h2 id="receipts-heading" className="text-lg font-semibold">
          Receipts
        </h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-slate-600">No receipts yet. They are issued once the payment is confirmed.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {receipts.map((r) => (
              <li key={r.idx}>
                {r.payableId}: {r.openError ? <span>could not be opened ({r.openError})</span> : <a href={r.url} rel="noreferrer" className="text-sky-700 underline">receipt link</a>}{" "}
                <span className="text-slate-500">(anyone with this link can verify the payment)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
