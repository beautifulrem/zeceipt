import { serverContext } from "../../../lib/server/context.ts";
import { BLANK_LINE } from "../../../lib/view/draft-form.ts";
import { PageHeader } from "../../components/page-header.tsx";
import { DraftForm } from "./draft-form.tsx";

export const dynamic = "force-dynamic";

const HINT = { main: "u1… (unified address)", test: "utest1… (unified address)", regtest: "uregtest1… (unified address)" } as const;

export default function NewBatchPage() {
  const { config } = serverContext();
  // Three blank lines, so the form works without JavaScript; "+ Add line" adds more when it runs.
  const initial = { title: "", lines: [{ ...BLANK_LINE }, { ...BLANK_LINE }, { ...BLANK_LINE }], top: [], lineErrors: {}, submission: 0 };
  return (
    <>
      <PageHeader eyebrow="Payouts" title="New batch" description="Type the lines, or fill them from a Konclave CSV. Nothing is paid until the batch is approved and you press Pay." />
      <DraftForm initial={initial} addressHint={HINT[config.network]} />
    </>
  );
}
