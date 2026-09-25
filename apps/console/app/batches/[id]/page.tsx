import Link from "next/link";
import { notFound } from "next/navigation";
import { getBatch, isSubmitted, rateFixed, rateLockFrozen } from "../../../lib/data/batches.ts";
import { currentLock } from "../../../lib/data/rates.ts";
import { voidable } from "../../../lib/data/voids.ts";
import { batchLinkability, disclosedReceivers } from "../../../lib/data/linkability.ts";
import { disclosedText } from "../../../lib/view/linkability.ts";
import { LinkabilityNote } from "../../components/linkability.tsx";
import { listReceipts } from "../../../lib/data/receipts.ts";
import { getBatchStatus, type BatchStatus } from "../../../lib/data/status.ts";
import { ZkoolGraphqlError, ZkoolTransportError } from "../../../lib/execution/zkool-client.ts";
import { approvalCheck, serverContext } from "../../../lib/server/context.ts";
import { rateText, sourceName, usdText, zecText } from "../../../lib/view/format.ts";
import { Address } from "../../components/address.tsx";
import { paymentMode } from "../../../lib/view/mode.ts";
import { STATUS_UNAVAILABLE, stateView } from "../../../lib/view/status.ts";
import { ZecAmount } from "../../components/amount.tsx";
import { AccessNotice, ModePanel } from "../../components/panels.tsx";
import { Lifecycle, StatusBadge } from "../../components/status.tsx";
import { ApproveForm, IssueForm, LockRateForm, PayForm } from "./action-forms.tsx";

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
      status = await getBatchStatus(ctx.db, ctx.backend, ctx.config.orgId, rec.id, { requiredConfirmations: ctx.config.confirmations, approval: approvalCheck(ctx) });
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
  // A lock is allowed until an attempt may have paid: also after a refusal (failed_retryable), migration 0014.
  const lockFrozen = await rateLockFrozen(ctx.db, rec);
  // Slice H5d: offered only while nothing can have been sent (the route stays the authority).
  const canVoid = await voidable(ctx.db, rec);
  // REQ-CON-6 (slice H6): the batch validation report's linkability part, while the operator can still act on it
  // (nothing sent: the draft can be voided and made again with a fresh address).
  const linkable = canVoid ? batchLinkability(await disclosedReceivers(ctx.db, rec.orgId), rec) : [];
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
            {status.next === "approve" &&
              (lock ? (
                // Slice I3: every payment needs an approval of the batch as shown, at this lock (re-lock: approve again).
                <>
                  <p className="text-sm">Check the lines, the total and the locked rate below, then approve. Pay is offered once approved.</p>
                  <ApproveForm id={rec.id} totalZat={total.toString()} totalText={zecText(total)} lockSeq={lock.seq} rate={rateText(lock.rate)} />
                </>
              ) : (
                <p className="text-sm">
                  <strong>Lock the ZEC/USD rate below before approving.</strong> The approval and the payment are checked against it.
                </p>
              ))}
            {status.next === "submit" &&
              (lock || submitted ? (
                <PayForm id={rec.id} totalZat={total.toString()} totalText={zecText(total)} again={status.state === "needs_attention"} />
              ) : (
                // REQ-CON-21 (slice G2b2): the first payment needs a rate lock, so Pay is not offered before one.
                <p className="text-sm">
                  <strong>Lock the ZEC/USD rate below before paying.</strong> The payment is checked against it.
                </p>
              ))}
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
        {rec.voidedAt !== undefined && !status && (
          // In hot custody the status panel above already says "Voided"; external custody has no status panel.
          <p className="text-sm">
            <strong>Voided</strong> on {rec.voidedAt.slice(0, 10)}: this batch can never be paid. Its lines and history stay on record.
          </p>
        )}
        {canVoid && (
          // GOV.UK (R83): the first step of a destructive action is not a button; the confirmation page has the warning button.
          <p className="text-sm">
            <Link href={`/batches/${rec.id}/void`} className="text-sky-700 underline">
              Void this draft…
            </Link>{" "}
            <span className="text-slate-500">Possible only while nothing has been sent.</span>
          </p>
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
        {rec.voidedAt !== undefined ? (
          <p className="text-sm text-slate-500">Voided: the rate can no longer be locked.</p>
        ) : rateFixed(rec) ? (
          // Slice H5a: the lines were converted at this lock (BTCPay's fixed payout rate), so there is no Re-lock.
          <p className="text-sm text-slate-500">
            Made from payables: each line was converted from its US dollars at this rate, so the rate is fixed. To pay at another rate,{" "}
            {canVoid ? (
              <Link href={`/batches/${rec.id}/void`} className="text-sky-700 underline">
                void this draft
              </Link>
            ) : (
              "void this draft"
            )}{" "}
            and make a new batch from its payables.
          </p>
        ) : lockFrozen ? (
          <p className="text-sm text-slate-500">A payment attempt may have paid this batch: its rate can no longer be changed.</p>
        ) : (
          <LockRateForm id={rec.id} locked={lock !== undefined} />
        )}
      </section>

      {linkable.length > 0 && (
        <section aria-labelledby="linkability-heading" className="space-y-2 rounded-lg border border-amber-300 p-4">
          <h2 id="linkability-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Before paying: addresses already disclosed
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {linkable.map((l) => {
              const line = rec.items.find((i) => i.idx === l.idx)!;
              return (
                <li key={l.idx}>
                  Line {l.idx + 1} ({line.label || line.memo}): {disclosedText(l.disclosedBy.map((d) => d.title))}
                </li>
              );
            })}
          </ul>
          <LinkabilityNote />
        </section>
      )}

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
                <td>
                  <Address value={i.address} />
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
