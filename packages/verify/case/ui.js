// DOM helpers shared by the case review page (case/page.js) and the dossier builder (build/page.js). Text is only ever
// set with textContent or text nodes, so nothing from a dossier is parsed as HTML.
import { el, copyButton } from "../r/ui.js";
import { STATUS_LABEL, STATUS_HELP, KIND_HELP } from "./view.js";

/** A status badge: an icon and a word, so the status never rests on colour alone; its tooltip says what it means. */
export function badge(status) {
  const b = el("span", `badge badge-${status}`);
  if (STATUS_HELP[status]) b.title = STATUS_HELP[status];
  const icon = el("span", "badge-icon");
  icon.setAttribute("aria-hidden", "true");
  b.append(icon, document.createTextNode(STATUS_LABEL[status] ?? status));
  return b;
}

/** Rows of a claims table from view.js claimRows. */
export function claimTableRows(rows) {
  return rows.map((r) => {
    const tr = el("tr", `tone-${r.status}`);
    const kind = el("td", "kind", r.kindLabel);
    if (KIND_HELP[r.kind]) kind.title = KIND_HELP[r.kind];
    tr.append(el("td", "num", String(r.number)), kind);
    const st = el("td", "state");
    st.append(badge(r.status));
    const what = el("td", "what");
    what.append(el("p", "", r.summary));
    // Flags beyond the status: funds not traced or not fully explained (amber), the assigned deposit address (green).
    for (const f of r.flags ?? []) what.append(el("p", `row-flag flag-${f.tone}`, f.text));
    if (r.details.length) {
      const ul = el("ul", "details");
      ul.append(...r.details.map((d) => el("li", "", d)));
      what.append(ul);
    }
    tr.append(st, what);
    return tr;
  });
}

/** Facts as the items of a description list (`<dl class="facts">`); keys in `wide` span two columns and are set as
 * identifiers, with a copy button. */
export function factItems(pairs, { live, wide = {} } = {}) {
  return pairs.map(([k, v]) => {
    const div = el("div", wide[k] ? "fact fact-wide" : "fact");
    div.dataset.key = k;
    const dd = el("dd");
    if (wide[k]) {
      dd.append(el("code", "", v));
      if (navigator.clipboard) dd.append(copyButton(v, wide[k], live));
    } else dd.textContent = v;
    div.append(el("dt", "", k), dd);
    return div;
  });
}

/** A list item for the .discloses / .checks / .limits lists (one text block per item, beside its icon). */
export const listItem = (text) => {
  const li = el("li");
  li.append(el("span", "", text));
  return li;
};

/** Save text as a file through a temporary link (a blob: URL, revoked after the click). */
export function download(text, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The sha256 (hex) of the verifier's WebAssembly, the file initVerifier loaded (../pkg/zeceipt_wasm_bg.wasm, same
 * origin, so the page's connect-src 'self' allows it; the browser's cache usually answers). A reader compares it with
 * the one the README publishes. Null when the browser has no Web Crypto here (a page not served over HTTPS or from
 * localhost) or the file cannot be read.
 */
export async function verifierDigest() {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const res = await fetch(new URL("../pkg/zeceipt_wasm_bg.wasm", import.meta.url));
    if (!res.ok) return null;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", await res.arrayBuffer()));
    return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The footer's "Verifier: zeceipt_wasm_bg.wasm sha256 …" line, into `node`, once the digest is known. */
export async function showVerifierDigest(node) {
  const sha = await verifierDigest();
  node.replaceChildren(document.createTextNode("Verifier: zeceipt_wasm_bg.wasm sha256 "), el("code", "", sha ?? "not computed in this browser"));
  node.hidden = false;
  return sha;
}
