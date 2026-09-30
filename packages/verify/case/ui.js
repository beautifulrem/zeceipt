// DOM helpers shared by the case review page (case/page.js) and the dossier builder (build/page.js). Text is only ever
// set with textContent or text nodes, so nothing from a dossier is parsed as HTML.
import { el, copyButton } from "../r/ui.js";
import { STATUS_LABEL } from "./view.js";

/** A status badge: an icon and a word, so the status never rests on colour alone. */
export function badge(status) {
  const b = el("span", `badge badge-${status}`);
  const icon = el("span", "badge-icon");
  icon.setAttribute("aria-hidden", "true");
  b.append(icon, document.createTextNode(STATUS_LABEL[status] ?? status));
  return b;
}

/** Rows of a claims table from view.js claimRows. */
export function claimTableRows(rows) {
  return rows.map((r) => {
    const tr = el("tr", `tone-${r.status}`);
    tr.append(el("td", "num", String(r.number)), el("td", "kind", r.kindLabel));
    const st = el("td", "state");
    st.append(badge(r.status));
    const what = el("td", "what");
    what.append(el("p", "", r.summary));
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
