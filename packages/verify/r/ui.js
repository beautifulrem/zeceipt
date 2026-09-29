// Small DOM helpers shared by the receipt page (page.js) and the paste demo (../demo/). Text is only ever set with
// textContent or text nodes, so nothing from a receipt is parsed as HTML.
import { valueParts } from "./view.js";

export const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A copy button for a long identifier: icon only, so a cell's text is still exactly the value. The result is
 * announced through `live`, a polite status region (a label change on a focused button is not reliably read). */
export function copyButton(value, label, live) {
  const b = el("button", "copy");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", async () => {
    let said = "Copied";
    try { await navigator.clipboard.writeText(value); b.dataset.copied = ""; }
    catch { said = "Copy failed: select the text instead"; }
    if (live) live.textContent = said;
    setTimeout(() => { delete b.dataset.copied; if (live && live.textContent === said) live.textContent = ""; }, 1600);
  });
  return b;
}

/** "2.5" + lighter "0000000" + " ZEC" + the zatoshi on its own line; textContent is "2.50000000 ZEC (250000000 zat)". */
export function amountNodes({ zec, zat }) {
  const { major, zeros } = valueParts(zec);
  return [el("span", "amount", major), el("span", "amount-zeros", zeros), el("span", "amount-unit", " ZEC"), el("span", "amount-zat", ` (${zat} zat)`)];
}

/** Text with any "(key id …)" kept on one line (a key id such as 2026-09 must not break at its hyphen; review F
 * round 6), as nodes. */
export function keyIdNodes(text) {
  return text.split(/(\(key id [^)]+\))/).filter(Boolean).map((part) => (/^\(key id /.test(part) ? el("span", "nowrap", part) : document.createTextNode(part)));
}

/** An issuer line with its 64-hex key in the mono face and its key id unbroken (text nodes only). */
export function issuerLine(line) {
  const li = el("li");
  for (const part of line.split(/([0-9a-f]{64})/)) if (part) li.append(...(/^[0-9a-f]{64}$/.test(part) ? [el("code", "", part)] : keyIdNodes(part)));
  return li;
}

export const COPYABLE = { Transaction: "Copy the transaction id", Recipient: "Copy the recipient address" };

/** Key–value rows (data-key for the stylesheet); Value laid out from `amount`, long ids with a copy button. */
export function kvRows(pairs, { amount, live } = {}) {
  return pairs.map(([k, v]) => {
    const tr = el("tr");
    tr.dataset.key = k;
    tr.append(el("td", "", k));
    const td = el("td");
    if (k === "Value" && amount) td.append(...amountNodes(amount));
    else {
      const span = el("span");
      span.append(...keyIdNodes(v));
      td.append(span);
      if (COPYABLE[k] && navigator.clipboard) td.append(copyButton(v, COPYABLE[k], live));
    }
    tr.append(td);
    return tr;
  });
}
