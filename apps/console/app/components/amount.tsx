// A ZEC amount in a table (slice G1d): every digit shown, the last five decimals lighter, as Zkool displays
// amounts (R73), but at a contrast that still meets WCAG AA (slate-500, 4.77:1 in Tailwind v4; review G1d: slate-400 was 2.63:1,
// and for small payments the lighter digits are the whole amount). One inline text run: copying it gives the whole number, and a screen reader reads one string.
import { zecParts } from "../../lib/view/format.ts";

export function ZecAmount({ zat }: { zat: bigint }) {
  const { major, minor } = zecParts(zat);
  return (
    <span title={`${zat} zatoshi`} className="tabular-nums">
      {major}
      <span className="text-[0.85em] text-slate-500">{minor}</span> ZEC
    </span>
  );
}
