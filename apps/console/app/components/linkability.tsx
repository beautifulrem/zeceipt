// The linkability warning's explanation (slice H6; REQ-CON-6): spec §9's sentence, verbatim, and the remedy. Shown
// once per page, where a line or recipient is flagged; the flags link to it (`#linkability`).
import { LINKABILITY_REMEDY, LINKABILITY_SPEC } from "../../lib/view/linkability.ts";

export function LinkabilityNote() {
  return (
    <div id="linkability" className="callout tone-warning flex-col gap-1">
      <p>
        <strong>Linkability:</strong> {LINKABILITY_SPEC}
      </p>
      <p>{LINKABILITY_REMEDY}</p>
    </div>
  );
}
