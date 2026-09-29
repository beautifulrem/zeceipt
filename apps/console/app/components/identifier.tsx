// An id in a table (slice M1b): a UUID abridged to its distinguishing tail, with the whole id one click or key press
// away in a native <details>, as `Address` does (review H2: a `title` alone is hover-only). Other ids are shown whole.
import { abridgeId } from "../../lib/view/format.ts";

export function Identifier({ value }: { value: string }) {
  const { short, whole } = abridgeId(value);
  if (short === whole) return <code>{whole}</code>;
  return (
    <details className="reveal">
      <summary title={whole}>
        <code>{short}</code>
      </summary>
      <code>{whole}</code>
    </details>
  );
}
