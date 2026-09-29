// A ZEC amount in a table (slice G1d): every digit shown, the last five decimals lighter, as Zkool displays
// amounts (R73), with the shared `.amount-zeros` rule (globals.css, the receipt page's too) in the `muted` token, which test/contrast.test.ts holds to WCAG AA (4.5:1) on every surface in both
// colour schemes (review G1d: for small payments the lighter digits are the whole amount). One inline text run: copying it gives the whole number, and a screen reader reads one string.
import { zecParts } from "../../lib/view/format.ts";

export function ZecAmount({ zat }: { zat: bigint }) {
  const { major, minor } = zecParts(zat);
  return (
    <span title={`${zat} zatoshi`} className="tabular-nums">
      {major}
      <span className="amount-zeros">{minor}</span> ZEC
    </span>
  );
}
