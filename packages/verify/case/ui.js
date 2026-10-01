// DOM helpers shared by the case review page (case/page.js) and the dossier builder (build/page.js). Text is only ever
// set with textContent or text nodes, so nothing from a dossier is parsed as HTML.
import { el, copyButton, idEl, amountEl } from "../r/ui.js";
import { heightText } from "../r/view.js";
import { STATUS_LABEL, STATUS_HELP, KIND_HELP } from "./view.js";

/**
 * A status badge (Blockscout's StatusTag): an icon and a word, so the status never rests on colour alone; its
 * tooltip says what it means. A compact badge shows the icon alone and keeps the word for screen readers.
 */
export function badge(status, { compact = false, label = null } = {}) {
  const b = el("span", `badge badge-${status}${compact ? " is-compact" : ""}`);
  if (STATUS_HELP[status]) b.title = STATUS_HELP[status];
  const icon = el("span", "badge-icon");
  icon.setAttribute("aria-hidden", "true");
  b.append(icon, el("span", "badge-word", label ?? STATUS_LABEL[status] ?? status));
  return b;
}

/** A claim's direction (Otterscan's TransactionDirection): funds in, out, or within the wallet. Decorative. */
const DIRECTION = { origin: ["in", "In"], path: ["self", "Within the wallet"], control: ["self", "Within the wallet"], deposit: ["out", "Out"], transparent_payment: ["out", "Out"] };
export function kindTag(kind) {
  const [icon, word] = DIRECTION[kind] ?? ["self", ""];
  const t = el("span", "kind-tag");
  t.title = word;
  t.setAttribute("aria-hidden", "true");
  t.append(el("span", `i i-${icon}`));
  return t;
}

/** A hint (Blockscout's DetailedInfo): a (?) that opens one sentence, with no script. */
export function tip(text, label, { end = false } = {}) {
  const d = el("details", `tip${end ? " tip-end" : ""}`);
  const s = el("summary");
  s.setAttribute("aria-label", label);
  d.append(s, el("p", "tip-body", text));
  return d;
}

/** Note ids ("n1", "n2, n3") as spans keyed for the page's hover highlight. */
export function noteRefs(ids) {
  const out = [];
  ids.forEach((id, k) => {
    if (k) out.push(document.createTextNode(", "));
    const s = el("span", "note-ref", id);
    s.dataset.key = `note:${id}`;
    out.push(s);
  });
  return out;
}

/**
 * Rows of a claims table from view.js claimRows: the number, the kind, one status badge, the transaction (with its
 * height and notes) and the amount. Flags beyond the status stay in view; the chain's own words open on demand, and a
 * claim that did not verify shows its reason first. Each row is #claim-N, so a verdict can link to it.
 */
export function claimTableRows(rows, { network = null, live = null } = {}) {
  return rows.map((r) => {
    const flagged = (r.flags ?? []).some((f) => f.tone === "warn");
    const tr = el("tr", `tone-${r.status}${r.status === "verified" && !flagged ? " is-plain" : ""}`);
    tr.id = `claim-${r.number}`;
    const kind = el("td", "kind");
    if (KIND_HELP[r.kind]) kind.title = KIND_HELP[r.kind];
    kind.append(kindTag(r.kind), document.createTextNode(r.kindLabel));
    tr.append(el("td", "num", String(r.number)), kind);
    const st = el("td", "state");
    st.append(badge(r.status));
    const what = el("td", "what");
    if (r.status !== "verified") what.append(el("p", "claim-why", r.summary));
    const main = el("div", "what-main");
    if (r.txid) {
      main.append(idEl(r.txid, { kind: "tx", network, live, key: `tx:${r.txid}` }));
      if (r.height != null) main.append(el("span", "what-sub", `height ${heightText(r.height)}`));
    }
    if (r.from?.length || r.to?.length) {
      const notes = el("span", "what-notes");
      notes.append(...noteRefs(r.from ?? []), document.createTextNode(r.from?.length ? " → " : "→ "), ...(r.toNotes ? noteRefs(r.to) : [document.createTextNode((r.to ?? []).join(", "))]));
      main.append(notes);
    }
    what.append(main);
    // Flags beyond the status: funds not traced or not fully explained (amber), the assigned deposit address (green).
    for (const f of r.flags ?? []) what.append(el("p", `row-flag flag-${f.tone}`, f.text));
    if (r.status === "verified" || r.details.length) {
      const more = el("details", "claim-more");
      more.append(el("summary", "", "What the chain shows"));
      if (r.status === "verified") more.append(el("p", "", r.summary));
      if (r.details.length) {
        const ul = el("ul", "details");
        ul.append(...r.details.map((d) => el("li", "", d)));
        more.append(ul);
      }
      what.append(more);
    }
    const amount = el("td", "amount");
    if (r.zat !== undefined) amount.append(amountEl(r.zat, network));
    tr.append(st, what, amount);
    return tr;
  });
}

/**
 * Facts as a key–value list (`<dl class="facts kv-list">`); keys in `ids` are set as identifiers (with a copy button),
 * named by the value of that key: `{ "Dossier sha256": { kind: "hash", label: "dossier sha256" } }`.
 */
export function factItems(pairs, { live, ids = {}, network = null } = {}) {
  return pairs.map(([k, v]) => {
    const spec = ids[k];
    const div = el("div", spec ? "fact fact-wide" : "fact");
    div.dataset.key = k;
    const dd = el("dd");
    if (spec) dd.append(idEl(v, { kind: spec.kind ?? "hash", network, live, label: spec.label, tail: spec.tail ?? 8, key: spec.key }));
    else dd.textContent = v;
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

/** A "not established" item as a topic and its reason ("who the counterparties are: an origin shows…"). */
export const limitItem = (text) => {
  const li = el("li");
  const at = String(text).indexOf(": ");
  if (at > 0) {
    const topic = text.slice(0, at);
    li.append(el("span", "topic", topic.charAt(0).toUpperCase() + topic.slice(1)), el("span", "why-not", text.slice(at + 2)));
  } else li.append(el("span", "topic", text));
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

/**
 * Otterscan's selection highlight: hovering or focusing anything with a data-key lights up every element with the
 * same key on the page (a note in the table, the diagram and the transactions; an address; a transaction).
 */
export function linkSelection(root = document.body) {
  let on = null;
  const set = (key) => {
    if (key === on) return;
    for (const e of root.querySelectorAll(".is-selected")) e.classList.remove("is-selected");
    for (const svg of root.querySelectorAll("svg.has-selection")) svg.classList.remove("has-selection");
    on = key;
    if (!key) return;
    const hits = [...root.querySelectorAll("[data-key]")].filter((e) => e.dataset.key === key);
    if (hits.length < 2) return;
    for (const e of hits) {
      e.classList.add("is-selected");
      e.closest("svg")?.classList.add("has-selection");
    }
  };
  const keyOf = (t) => (t instanceof Element ? t.closest("[data-key]")?.dataset.key ?? null : null);
  const ok = (k) => k && /^(note|tx|addr|pay):/.test(k);
  root.addEventListener("mouseover", (e) => { const k = keyOf(e.target); set(ok(k) ? k : null); });
  root.addEventListener("focusin", (e) => { const k = keyOf(e.target); set(ok(k) ? k : null); });
  root.addEventListener("mouseleave", () => set(null));
}

export { copyButton };
