import { listRecipients } from "../../lib/data/recipients.ts";
import { UA_HRP } from "../../lib/execution/address.ts";
import { serverContext } from "../../lib/server/context.ts";
import { shortAddress } from "../../lib/view/format.ts";
import { AccessNotice } from "../components/panels.tsx";
import { RecipientForm } from "./recipient-form.tsx";

export const dynamic = "force-dynamic";

const KYC: Record<string, string> = { unknown: "Unknown", verified: "Verified", not_required: "Not required" };
const TAX: Record<string, string> = { none: "None", us_1099: "US 1099", non_us: "Non-US" };
const SETTLE: Record<string, string> = { zec: "ZEC", usdc_sol: "USDC (Solana)" };

/** The recipient directory (slice H2; REQ-CON-2; 04 SCR-2). A duplicate address is a flag, never an error (05). */
export default async function RecipientsPage() {
  const { config, db } = serverContext();
  const list = await listRecipients(db, config.orgId);
  const names = new Map(list.map((r) => [r.id, r.displayName]));
  return (
    <>
      <AccessNotice />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Recipients</h1>
        <p className="text-sm text-slate-500">People and wallets this org pays. Batch lines copy a recipient&apos;s name and address, so later changes here never rewrite a payment.</p>
      </header>
      {list.length === 0 ? (
        <p className="text-sm">No recipients yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Recipients</caption>
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Address</th>
              <th>KYC</th>
              <th>Tax</th>
              <th>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="py-2">
                  {r.displayName}
                  {r.duplicateOf.length > 0 && (
                    <p className="text-xs text-amber-800">Pays the same Orchard receiver as {r.duplicateOf.map((id) => names.get(id)).join(", ")}</p>
                  )}
                </td>
                <td className="py-2" title={r.address}>
                  <code>{shortAddress(r.address)}</code>
                </td>
                <td className="py-2">{KYC[r.kycStatus]}</td>
                <td className="py-2">{TAX[r.taxFlag]}</td>
                <td className="py-2">{SETTLE[r.settlementPref]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <RecipientForm addressHint={`${UA_HRP[config.network]}1…`} />
    </>
  );
}
