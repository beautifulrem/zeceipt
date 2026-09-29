import { disclosedReceivers, disclosersOf } from "../../lib/data/linkability.ts";
import { listRecipients } from "../../lib/data/recipients.ts";
import { disclosedText } from "../../lib/view/linkability.ts";
import { UA_HRP } from "../../lib/execution/address.ts";
import { serverContext } from "../../lib/server/context.ts";
import { Address } from "../components/address.tsx";
import { shortAddress } from "../../lib/view/format.ts";
import { LinkabilityNote } from "../components/linkability.tsx";
import { TableCard } from "../components/table-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { RecipientForm } from "./recipient-form.tsx";
import { TABLE_CLASS } from "../../lib/view/table.ts";

export const dynamic = "force-dynamic";

const KYC: Record<string, string> = { unknown: "Unknown", verified: "Verified", not_required: "Not required" };
const TAX: Record<string, string> = { none: "None", us_1099: "US 1099", non_us: "Non-US" };
const SETTLE: Record<string, string> = { zec: "ZEC", usdc_sol: "USDC (Solana)" };

/** The recipient directory (slice H2; REQ-CON-2; 04 SCR-2). A duplicate address is a flag, never an error (05). */
export default async function RecipientsPage() {
  const { config, db } = serverContext();
  const list = await listRecipients(db, config.orgId);
  // REQ-CON-6 (slice H6): recipients whose address a receipt already disclosed.
  const disclosed = await disclosedReceivers(db, config.orgId);
  const disclosedBy = new Map(list.map((r) => [r.id, disclosersOf(disclosed, r.address, r.network)]));
  const anyDisclosed = [...disclosedBy.values()].some((d) => d.length > 0);
  const names = new Map(list.map((r) => [r.id, r.displayName]));
  return (
    <>
      <PageHeader eyebrow="Directory" title="Recipients" description={<>People and wallets this org pays. Batch lines copy a recipient&apos;s name and address, so later changes here never rewrite a payment.</>} />
      {list.length === 0 ? (
        <p className="card text-sm text-muted">No recipients yet.</p>
      ) : (
        <TableCard label="Recipients">
        <table className={TABLE_CLASS}>
          <caption className="sr-only">Recipients</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th className="hidden sm:table-cell">Address</th>
              <th>KYC</th>
              <th className="hidden md:table-cell">Tax</th>
              <th className="hidden md:table-cell">Settlement</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  {r.displayName}
                  {/* On a phone the address prefix sits under the name (review F round 3). */}
                  <div className="max-w-[9rem] truncate font-mono text-xs font-normal text-muted sm:hidden">{shortAddress(r.address)}</div>
                  {r.duplicateOf.length > 0 && (
                    <p className="text-xs text-warning">Pays the same Orchard receiver as {r.duplicateOf.map((id) => names.get(id)).join(", ")}</p>
                  )}
                  {disclosedBy.get(r.id)!.length > 0 && (
                    <p className="text-xs text-warning">
                      {disclosedText(disclosedBy.get(r.id)!.map((d) => d.title))}{" "}
                      <a href="#linkability" className="link">
                        Why this matters
                      </a>
                    </p>
                  )}
                </td>
                <td className="hidden sm:table-cell">
                  <Address value={r.address} />
                </td>
                <td>
                  <span className={`badge ${r.kycStatus === "verified" ? "tone-success" : r.kycStatus === "not_required" ? "tone-neutral" : "tone-warning"}`}>{KYC[r.kycStatus]}</span>
                </td>
                <td className="hidden md:table-cell">{TAX[r.taxFlag]}</td>
                <td className="hidden md:table-cell">{SETTLE[r.settlementPref]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableCard>
      )}
      {anyDisclosed && <LinkabilityNote />}
      <RecipientForm addressHint={`${UA_HRP[config.network]}1…`} />
    </>
  );
}
