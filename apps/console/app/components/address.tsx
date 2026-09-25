// A unified address in a table (review H2): the ZIP 316 prefix (`shortAddress`), and the whole address one click or
// key press away in a native <details>, so keyboard and touch users can check it against an invoice (a `title` is
// hover-only). No JavaScript needed.
import { shortAddress } from "../../lib/view/format.ts";

export function Address({ value }: { value: string }) {
  const short = shortAddress(value);
  if (short === value) return <code>{value}</code>;
  return (
    <details>
      <summary className="cursor-pointer whitespace-nowrap" title={value}>
        <code>{short}</code>
      </summary>
      <code className="block max-w-xs break-all text-xs">{value}</code>
    </details>
  );
}
