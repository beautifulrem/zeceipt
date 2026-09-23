import { notFound } from "next/navigation";
import { getBatch, isSubmitted } from "../../../lib/data/batches.ts";
import { currentLock } from "../../../lib/data/rates.ts";
import { listReceipts } from "../../../lib/data/receipts.ts";
import { getBatchStatus, type BatchStatus } from "../../../lib/data/status.ts";
import { ZkoolGraphqlError, ZkoolTransportError } from "../../../lib/execution/zkool-client.ts";
import { serverContext } from "../../../lib/server/context.ts";
import { rateText, shortAddress, sourceName, usdText, zecText } from "../../../lib/view/format.ts";
import { paymentMode } from "../../../lib/view/mode.ts";
import { STATUS_UNAVAILABLE, stateView } from "../../../lib/view/status.ts";
import { ZecAmount } from "../../components/amount.tsx";
import { AccessNotice, ModePanel } from "../../components/panels.tsx";
import { Lifecycle, StatusBadge } from "../../components/status.tsx";
import { IssueForm, LockRateForm, PayForm } from "./action-forms.tsx";

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
  const lock = await currentLock(ctx.db, ctx.config.orgId, rec.id);
  const submitted = await isSubmitted(ctx.db, rec);
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
            {status.next === "submit" && (
              <PayForm id={rec.id} totalZat={total.toString()} totalText={zecText(total)} again={status.state === "needs_attention"} />
            )}
            {status.next === "issue_receipts" && <IssueForm id={rec.id} />}
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

      <section aria-labelledby="rate-heading" className="space-y-2 rounded-lg border border-slate-200 p-4">
        <h2 id="rate-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          ZEC/USD rate
        </h2>
        {lock ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Locked rate</dt>
            <dd>
              <strong>{rateText(lock.rate)}</strong> <span className="text-slate-500">(bid, exactly {lock.rate})</span>
            </dd>
            <dt className="text-slate-500">Source</dt>
            <dd>
              {sourceName(lock.source)} {lock.pair} · ask {lock.ask} · last trade {lock.last}
            </dd>
            <dt className="text-slate-500">Fetched</dt>
            <dd>{lock.fetchedAt.replace("T", " ").slice(0, 19)} UTC</dd>
          </dl>
        ) : (
          <p className="text-sm">Not locked. Lock the rate to record the ZEC/USD value this batch is based on (source and time kept).</p>
        )}
        {submitted ? (
          <p className="text-sm text-slate-500">The batch has been submitted: its rate can no longer be changed.</p>
        ) : (
          <LockRateForm id={rec.id} locked={lock !== undefined} />
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
              {lock && <th className="text-right">USD at lock</th>}
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
                <td className="text-right">
                  <ZecAmount zat={i.zat} />
                </td>
                {lock && <td className="text-right">{usdText(i.zat, lock.rate)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 text-right font-semibold">
                Total
              </td>
              <td className="text-right font-semibold">
                <ZecAmount zat={total} />
              </td>
              {lock && <td className="text-right font-semibold">{usdText(total, lock.rate)}</td>}
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
