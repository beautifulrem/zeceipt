// Small DOM helpers shared by the receipt page (page.js) and the paste demo (../demo/). Text is only ever set with
// textContent or text nodes, so nothing from a receipt is parsed as HTML.
import { valueParts, explorerUrl, zecString, EXPLORER } from "./view.js";

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

/** "2.5" + lighter "0000000" + " ZEC" (or " TAZ" off mainnet) + the zatoshi on its own line; textContent is
 * "2.50000000 ZEC (250000000 zat)". */
export function amountNodes({ zec, zat, unit = "ZEC" }) {
  const { major, zeros } = valueParts(zec);
  return [el("span", "amount", major), el("span", "amount-zeros", zeros), el("span", "amount-unit", ` ${unit}`), el("span", "amount-zat", ` (${zat} zat)`)];
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

/** The verdict's line with its address in a <code> (text nodes only). */
export function noteNodes({ lead, addr, rest }) {
  return [document.createTextNode(lead), ...(addr ? [el("code", "", addr)] : []), document.createTextNode(rest)];
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

const KIND_WORD = { tx: "transaction", address: "address", block: "block", nonce: "nonce", hash: "hash", prevout: "output" };

/**
 * An identifier (FE04; mempool's truncate, Safe's highlight4bytes, Blockscout's AddressEntity): the head shortens with
 * an ellipsis to fit, the last `tail` characters never do, and the whole value stays in the text (find-in-page, a
 * selection, a screen reader and paper all get all of it). A copy button (24px), and a link to a public explorer when
 * one shows the value (explorerUrl). `key` (data-key) links every element naming the same thing, for the page's
 * hover highlight; `full` shows the whole value, wrapped.
 */
export function idEl(value, { kind = "tx", network = null, live = null, key = null, tail = 6, copy = true, full = false, label = null } = {}) {
  const v = String(value ?? "");
  const wrap = el("span", `id${full ? " id-full" : ""}`);
  if (key) wrap.dataset.key = key;
  const url = explorerUrl(kind, v, network);
  const text = el(url ? "a" : "span", "id-text");
  const cut = Math.max(0, v.length - tail);
  text.append(el("span", "id-head", v.slice(0, cut)), el("span", "id-tail", v.slice(cut)));
  const short = v.length > tail + 10 ? `${v.slice(0, 10)}…${v.slice(-tail)}` : v;
  if (url) {
    text.href = url;
    text.target = "_blank";
    text.rel = "noreferrer noopener";
    text.title = `${v}: open in ${EXPLORER[network].name}`;
    text.setAttribute("aria-label", `${label ?? KIND_WORD[kind] ?? kind} ${short}, on ${EXPLORER[network].name} (opens a new tab)`);
  } else text.title = v;
  wrap.append(text);
  if (copy && v && globalThis.navigator?.clipboard) wrap.append(copyButton(v, `Copy the ${label ?? KIND_WORD[kind] ?? kind} ${short}`, live));
  return wrap;
}

/**
 * An amount (FE07): eight decimals with the trailing zeros lighter (the console's .amount-zeros), tabular figures,
 * the unit small and muted; textContent is "0.20000000 TAZ". A value nobody can read is "•••••" (Blockscout's
 * ConfidentialValue), named for screen readers; `atLeast` marks a lower bound ("≥ 0.0500…").
 */
export function amountEl(zat, network, { unit = true, atLeast = false, unknown = "not known" } = {}) {
  const span = el("span", "amt");
  if (zat === null || zat === undefined) {
    span.classList.add("amt-none");
    span.append(el("span", "", "•••••"));
    span.setAttribute("title", unknown);
    span.append(el("span", "sr-only", ` (${unknown})`));
    return span;
  }
  const { major, zeros } = valueParts(zecString(zat));
  if (atLeast) span.append(document.createTextNode("≥ "));
  span.append(document.createTextNode(major));
  if (zeros) span.append(el("span", "amount-zeros", zeros));
  if (unit) span.append(el("span", "amt-unit", network === "main" ? " ZEC" : " TAZ"));
  return span;
}

