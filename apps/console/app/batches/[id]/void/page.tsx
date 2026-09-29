import { notFound } from "next/navigation";
import { getBatch } from "../../../../lib/data/batches.ts";
import { voidable } from "../../../../lib/data/voids.ts";
import { serverContext } from "../../../../lib/server/context.ts";
import { zecText } from "../../../../lib/view/format.ts";
import { AccessNotice } from "../../../components/panels.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { VoidForm } from "./void-form.tsx";

export const dynamic = "force-dynamic";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Confirm voiding a draft (slice H5d; GOV.UK's confirmation step for a destructive action, R83). */
export default async function VoidBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { config, db } = serverContext();
  const rec = UUID_V7.test(id) ? await getBatch(db, config.orgId, id) : undefined;
  if (!rec) notFound();
  const total = rec.items.reduce((s, i) => s + i.zat, 0n);
  const can = await voidable(db, rec);
  return (
    <>
      <AccessNotice />
      <PageHeader
        eyebrow="Void a draft"
        title={<>Void batch {rec.title}?</>}
        description={
          <>
            {rec.items.length} {rec.items.length === 1 ? "line" : "lines"}, {zecText(total)} in total.
          </>
        }
      />
      <section className="card max-w-2xl space-y-3 border-danger/40">
        {can && (
          <>
            <p className="text-sm">Nothing has been sent for this batch. Voiding is final: it can never be paid, and it cannot be undone. Its lines and history stay on record.</p>
            <p className="text-sm">Its memos and payables are released, so you can make a new batch from them, for example at today&apos;s rate.</p>
          </>
        )}
        <VoidForm
          id={rec.id}
          canVoid={can}
          reason={rec.voidedAt ? `This batch was voided on ${rec.voidedAt.slice(0, 10)}.` : "A payment attempt may have sent this batch, so it cannot be voided."}
        />
      </section>
    </>
  );
}
