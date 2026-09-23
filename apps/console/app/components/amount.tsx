// A ZEC amount in a table (slice G1d): every digit shown, the last five decimals lighter, as Zkool displays
// amounts (R73). One inline text run: copying it gives the whole number, and a screen reader reads one string.
import { zecParts } from "../../lib/view/format.ts";

export function ZecAmount({ zat }: { zat: bigint }) {
  const { major, minor } = zecParts(zat);
  return (
    <span title={`${zat} zatoshi`} className="tabular-nums">
      {major}
      <span className="text-[0.85em] text-slate-400">{minor}</span> ZEC
    </span>
  );
}
