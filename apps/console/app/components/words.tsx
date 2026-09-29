import { Fragment } from "react";

// Text that may wrap between words but never inside one (review F rounds 1–3): "BOUNTY-102" and "INV-R-002" stay
// whole, while "GRANT-7 milestone 2" can take two lines in a narrow column. The spaces sit between the no-wrap spans,
// where a line may break; the text content is unchanged.
export function Words({ text }: { text: string }) {
  return text.split(" ").map((w, i) => (
    <Fragment key={i}>
      {i > 0 && " "}
      <span className="whitespace-nowrap">{w}</span>
    </Fragment>
  ));
}
