import { serverContext } from "../../../lib/server/context.ts";
import { BLANK_LINE } from "../../../lib/view/draft-form.ts";
import { AccessNotice } from "../../components/panels.tsx";
import { DraftForm } from "./draft-form.tsx";

export const dynamic = "force-dynamic";

const HINT = { main: "u1… (unified address)", test: "utest1… (unified address)", regtest: "uregtest1… (unified address)" } as const;

export default function NewBatchPage() {
  const { config } = serverContext();
  // Three blank lines, so the form works without JavaScript; "+ Add line" adds more when it runs.
  const initial = { title: "", lines: [{ ...BLANK_LINE }, { ...BLANK_LINE }, { ...BLANK_LINE }], top: [], lineErrors: {}, submission: 0 };
  return (
    <>
      <AccessNotice />
      <h1 className="text-2xl font-semibold">New batch</h1>
      <DraftForm initial={initial} addressHint={HINT[config.network]} />
    </>
  );
}
