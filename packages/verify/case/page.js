// Case review page: opens a source-of-funds dossier (a file, pasted text, a case link's fragment, or the sample),
// fetches each transaction it names from a public node, checks every claim here (WebAssembly), and shows the case.
// The DOM is written with textContent only, so nothing from a dossier is ever parsed as HTML. Nothing is stored; the
// only requests outside this site are the transaction lookups (fetchRawTx: the txid and nothing else). The reviewer's
// nonce lives in this module's memory only.
import { initVerifier, checkDossier, dossierTxids, dossierPrevoutTxids, fetchRawTx, verifyReceipt, GRPC_WEB_ENDPOINTS } from "../src/index.js";
import { memoText } from "../r/view.js";
import { el, copyButton } from "../r/ui.js";
import { badge, claimTableRows, factItems, listItem, download } from "./ui.js";
import {
  SAMPLE_FRAGMENT, SAMPLE_PATH, NETWORK_NAME, readDossierInput, parseDossier, fetchProgress, caseVerdict, caseFacts, claimRows, flowSteps,
  nonceCheck, newNonce, caseSummaryText, reportForDownload, reportFileName, shortTxid, middle, noteLabel, KIND_LABEL, amountText,
} from "./view.js";

// Each node gets 12 s, as on the receipt page: two hanging nodes would otherwise keep a reviewer waiting 40 s.
const PAGE_TIMEOUT_MS = 12_000;

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const live = () => $("copy-live");
const RESULT_PARTS = ["banner", "flow-card", "claims-card", "funders-card", "scope"];

let generation = 0; // bumps on every new dossier, so a late result for an earlier one is dropped
let current = null; // { text, dossier, report, meta }
let generatedNonce = null; // the reviewer's nonce, in memory only
let verifierVersion = null;

function setStatus(text, state) {
  $("status").textContent = text;
  $("status").dataset.state = state;
}

function clearResult() {
  for (const id of RESULT_PARTS) show(id, false);
  $("banner").className = "result";
  $("verdict-live").textContent = "";
  $("nonce-result").textContent = "";
  delete document.body.dataset.state;
  current = null;
}

/**
 * Fetch every transaction the check needs, with progress, in the verifier's two rounds: the transactions the claims name,
 * then those whose outputs the origin transactions spend (the funders' addresses and values come from those outputs).
 * A node that cannot be reached gives way to the next; a node's "not found" answers for its network (as
 * fetchRawTxAnyNetwork has it), and the claims that need that transaction then say so. Any other failure stops the check.
 */
async function fetchAll(text, network, mine) {
  const endpoints = GRPC_WEB_ENDPOINTS[network] ?? [];
  if (!endpoints.length) throw new Error(`No public node serves the ${NETWORK_NAME[network] ?? network}: this page can check only mainnet and testnet dossiers.`);
  const txs = {};
  const used = new Set();
  let preferred = 0;
  for (const round of [0, 1]) {
    const ids = round === 0 ? dossierTxids(text) : dossierPrevoutTxids(text, txs).filter((t) => !(t in txs));
    for (const [i, txid] of ids.entries()) {
      let lastErr = null;
      let found = false;
      for (let k = 0; k < endpoints.length && !found; k++) {
        const ep = endpoints[(preferred + k) % endpoints.length];
        if (mine !== generation) return null;
        setStatus(fetchProgress(i, ids.length, ep, round), "loading");
        try {
          const r = await fetchRawTx(txid, network, [ep], { timeoutMs: PAGE_TIMEOUT_MS });
          txs[txid] = { hex: r.hex, height: r.chain.status === "mined" ? r.chain.height : null, mempool: r.chain.status === "mempool" };
          used.add(ep);
          preferred = endpoints.indexOf(ep);
          found = true;
        } catch (e) {
          lastErr = e;
          if (e.code === "not_found") break;
        }
      }
      if (!found && lastErr?.code !== "not_found") throw lastErr ?? new Error("the nodes could not be reached");
    }
  }
  return { txs, nodes: [...used] };
}

/** What each deposit's receipt opens (recipient, value, memo), for the timeline; the claim itself is checked by the verifier. */
function receiptPayments(dossier, txs) {
  const out = {};
  for (const [id, rc] of Object.entries(dossier?.receipts ?? {})) {
    const hex = txs[String(rc.txid).toLowerCase()]?.hex;
    if (!hex) continue;
    try {
      const v = verifyReceipt(JSON.stringify(rc), hex);
      if (v.valid) out[id] = { recipient: v.recipient, value_zat: v.value_zat, memo: memoText(v.memo) };
    } catch { /* the claim's row says why */ }
  }
  return out;
}

async function check(text, source) {
  const mine = ++generation;
  clearResult();
  $("inputs").open = true;
  const dossier = parseDossier(text);
  try {
    dossierTxids(text);
  } catch (e) {
    render(text, dossier, { all_verified: false, stage: "parse", error: String(e).replace(/^Error: /, "") }, { source });
    return;
  }
  $("check").disabled = true;
  try {
    const got = await fetchAll(text, dossier.network, mine);
    if (!got || mine !== generation) return;
    setStatus("Checking every claim in this page…", "loading");
    // The nonce generated in this page, if any, is the one every control claim must answer (the core's expect-nonce).
    const report = await checkDossier(text, { txs: got.txs, expectNonce: generatedNonce ?? "" });
    if (mine !== generation) return;
    const heights = Object.fromEntries(Object.entries(got.txs).map(([t, v]) => [t, v.height]));
    render(text, dossier, report, { source, txs: got.txs, checkedAt: new Date().toISOString(), nodes: got.nodes, heights, payments: receiptPayments(dossier, got.txs) });
  } catch (e) {
    if (mine !== generation) return;
    setStatus(`The check could not finish: ${String(e?.message ?? e)} Try again, or later.`, "error");
  } finally {
    if (mine === generation) $("check").disabled = false;
  }
}

function render(text, dossier, report, meta, { focus = true } = {}) {
  const v = caseVerdict(report);
  const readable = Boolean(v.counts);
  const nonce = readable ? nonceCheck(dossier, report, generatedNonce) : null;
  current = { text, dossier, report, meta: { ...meta, nonce, generated: generatedNonce, verifier: verifierVersion } };

  $("headline").textContent = v.headline;
  $("verdict-sub").textContent = v.sub;
  $("banner").className = `result ${v.tone}`;
  // Problems with the dossier as a whole (an nk that is not a key, say), which no single claim carries.
  $("banner-error").textContent = (report.problems ?? []).join(" ");
  show("banner-error", Boolean(report.problems?.length));
  $("facts").replaceChildren();
  show("nonce-line", false);
  show("case-actions", readable);
  if (readable) {
    $("facts").replaceChildren(...factItems(caseFacts(dossier, report, meta), { live: live(), wide: { "Dossier sha256": "Copy the dossier sha256" } }));
    $("nonce-line").textContent = nonce.text;
    $("nonce-line").dataset.state = nonce.state;
    show("nonce-line", true);
    renderFlow(flowSteps(dossier, report, meta));
    renderClaims(report);
    renderFunders(dossier, report);
    renderScope(report);
    $("nonce-result").textContent = nonce.text;
    $("print-meta").textContent = `Checked ${meta.checkedAt ? meta.checkedAt.slice(0, 16).replace("T", " ") + " UTC" : ""} in the browser with ${verifierVersion ?? "the zeceipt verifier"} on ${location.host || "this page"}. Dossier sha256 ${report.dossier_sha256}.`;
  }
  show("flow-card", readable);
  show("claims-card", readable);
  show("funders-card", readable && !$("funders").hidden);
  show("scope", readable);
  show("banner", true);
  $("inputs").open = false;
  document.body.dataset.state = "checked";
  setStatus(readable ? "Checked in this page." : "The dossier could not be read.", readable ? "checked" : "error");
  $("verdict-live").textContent = `${v.headline}. ${v.sub}`;
  if (!focus) return;
  $("banner").focus({ preventScroll: true });
  $("banner").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function txLine(txid, height) {
  const p = el("p", "step-tx");
  p.append(document.createTextNode(height != null ? `Height ${height} · tx ` : "Height unknown · tx "));
  const code = el("code", "", shortTxid(txid));
  code.title = txid;
  p.append(code);
  if (navigator.clipboard && txid) p.append(copyButton(txid, `Copy the transaction id ${shortTxid(txid)}`, live()));
  return p;
}

function noteChip(n) {
  const li = el("li", `chip-note${n.error ? " chip-bad" : ""}${n.reply ? " chip-reply" : ""}`);
  li.append(el("span", "chip-id", n.id), el("span", "chip-value", n.error ? "does not open" : n.value));
  if (n.reply && n.memo) li.append(el("span", "chip-memo", `memo “${n.memo}”`));
  if (n.next) li.append(el("span", "chip-next", `spent in step ${n.next}`));
  li.setAttribute("aria-label", `${noteLabel(n)}${n.reply && n.memo ? `, memo ${n.memo}` : ""}${n.next ? `, spent in step ${n.next}` : ""}`);
  return li;
}

function group(label, items) {
  const div = el("div", "step-group");
  div.append(el("p", "step-label", label));
  const ul = el("ul", "chips");
  ul.append(...items);
  div.append(ul);
  return div;
}

function renderFlow(steps) {
  const items = steps.map((s) => {
    const li = el("li", `step step-${s.stage} tone-${s.status}`);
    const head = el("div", "step-head");
    const h = el("h3", "step-title");
    h.append(el("span", "step-number", `Step ${s.number}`), document.createTextNode(s.title));
    head.append(h, badge(s.status));
    li.append(el("span", "step-dot"), head, txLine(s.txid, s.height));
    li.firstChild.setAttribute("aria-hidden", "true");
    const body = el("div", "step-body");
    if (s.funding.length) {
      const div = el("div", "step-group");
      div.append(el("p", "step-label", "Funded"));
      for (const f of s.funding) div.append(el("p", "step-funding", f.text));
      body.append(div);
    }
    if (s.spent.length) body.append(group("Spent", s.spent.map((n) => noteChip({ ...n, next: null }))));
    if (s.created.length) body.append(group(s.stage === "control" ? "Reply note" : s.stage === "origin" ? "Received" : "Notes created", s.created.map((n) => noteChip(n))));
    if (s.payments.length) {
      body.append(group("Paid out", s.payments.map((p) => {
        const c = el("li", "chip-note chip-pay");
        c.append(el("span", "chip-id", p.id), el("span", "chip-value", p.value));
        if (p.recipient) {
          const to = el("span", "chip-memo");
          to.append(document.createTextNode("to "), el("code", "", middle(p.recipient)));
          to.title = p.recipient;
          c.append(to);
        }
        if (p.memo) c.append(el("span", "chip-memo", `memo “${p.memo}”`));
        c.setAttribute("aria-label", `Payment ${p.id}: ${p.value}${p.recipient ? ` to ${p.recipient}` : ""}${p.memo ? `, memo ${p.memo}` : ""}`);
        return c;
      })));
    }
    li.append(body);
    const edges = el("ul", "edges");
    edges.setAttribute("aria-label", `Claims in step ${s.number}`);
    for (const e of s.edges) {
      const row = el("li", `edge tone-${e.status}`);
      row.append(el("span", "edge-kind", `#${e.index + 1} ${KIND_LABEL[e.kind]}`), el("span", "edge-label", e.label), badge(e.status));
      edges.append(row);
    }
    li.append(edges);
    return li;
  });
  $("flow").replaceChildren(...items);
}

function renderClaims(report) {
  $("claims").tBodies[0].replaceChildren(...claimTableRows(claimRows(report)));
}

function renderFunders(dossier, report) {
  const origins = (report.claims ?? []).filter((c) => c.kind === "origin");
  const blocks = origins.map((c) => {
    const noteId = dossier?.claims?.[c.index]?.note;
    const n = report.notes?.[noteId];
    const div = el("div", "funder");
    const h = el("h3", "", `Origin of ${noteId ?? "a note"}${n?.txid ? ` (tx ${shortTxid(n.txid)})` : ""}`);
    div.append(h);
    const f = c.funding;
    if (!f) { div.append(el("p", "muted", "Not established: the claim did not verify.")); return div; }
    const t = f.transparent_inputs ?? [];
    if (t.length) {
      div.append(el("p", "", `${t.length} transparent input${t.length === 1 ? "" : "s"} funded this transaction. Each address and value is read from the output the input spends, in the previous transaction; who holds an address is not proven here.`));
      const table = el("table", "kv funders-table");
      table.append(...t.map((i, k) => {
        const tr = el("tr");
        tr.dataset.key = `Input ${k + 1}`;
        const td = el("td");
        td.append(el("code", "", i.address ?? "address not known (the previous transaction was not found, or its output is not a standard one)"));
        if (i.address && navigator.clipboard) td.append(copyButton(i.address, `Copy the address of input ${k + 1}`, live()));
        td.append(el("span", "prevout", `${i.value_zat != null ? `${amountText(i.value_zat, report.network)}, ` : ""}spends ${shortTxid(i.prevout.split(":")[0])}:${i.prevout.split(":")[1]}`));
        tr.append(el("td", "", `Input ${k + 1}`), td);
        return tr;
      }));
      div.append(table);
    } else if (f.from_disclosed?.length) {
      div.append(el("p", "", `From disclosed notes of this dossier: ${f.from_disclosed.join(", ")}.`));
    } else {
      div.append(el("p", "", `No transparent input: it was paid from shielded funds of a sender the dossier does not disclose (${f.shielded_actions} shielded action${f.shielded_actions === 1 ? "" : "s"}${f.sapling_spends ? `, ${f.sapling_spends} Sapling spend${f.sapling_spends === 1 ? "" : "s"}` : ""}). Ask the holder who sent it, and for their evidence.`));
    }
    return div;
  });
  $("funders").replaceChildren(...blocks);
  $("funders").hidden = blocks.length === 0;
}

function renderScope(report) {
  $("disclosed").replaceChildren(...(report.disclosed ?? []).map(listItem));
  $("limits").replaceChildren(...(report.does_not_prove ?? []).map(listItem));
}

// ---- input ----

async function loadSample() {
  setStatus("Loading the sample dossier…", "loading");
  const mine = generation;
  const res = await fetch(SAMPLE_PATH, { cache: "no-store" });
  if (!res.ok) { setStatus(`The sample could not be loaded (HTTP ${res.status}).`, "error"); return; }
  const text = await res.text();
  if (mine !== generation) return;
  await check(text, "sample");
}

async function open(raw, source) {
  const r = readDossierInput(raw);
  if (r.sample) return loadSample();
  if (r.error) { clearResult(); setStatus(r.error, "error"); return; }
  await check(r.text, source);
}

/** A dossier opened some other way than the link: the link's fragment no longer says what is shown, so it goes. */
function dropFragment() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function fromHash() {
  const h = location.hash.slice(1);
  if (!h) return;
  open(h === SAMPLE_FRAGMENT ? `#${SAMPLE_FRAGMENT}` : `#${h}`, "link");
}

$("sample").addEventListener("click", () => { dropFragment(); loadSample(); });
$("check").addEventListener("click", () => { dropFragment(); open($("paste").value, "paste"); });
$("file").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  dropFragment();
  await open(await f.text(), "file");
  ev.target.value = "";
});
const drop = $("drop");
for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.dataset.drag = ""; });
for (const t of ["dragleave", "drop"]) drop.addEventListener(t, () => { delete drop.dataset.drag; });
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  dropFragment();
  await open(await f.text(), "file");
});
window.addEventListener("hashchange", fromHash);

// ---- actions ----

$("download").addEventListener("click", () => {
  if (!current?.report) return;
  const name = reportFileName(current.report);
  download(JSON.stringify(reportForDownload(current.report, current.meta), null, 2) + "\n", name);
  live().textContent = `Report downloaded as ${name}`;
});
$("print").addEventListener("click", () => window.print());
$("copy-summary").addEventListener("click", async () => {
  if (!current?.report) return;
  let said = "Case summary copied";
  try { await navigator.clipboard.writeText(caseSummaryText(current.dossier, current.report, current.meta)); }
  catch { said = "Copy failed: the browser refused the clipboard"; }
  live().textContent = said;
});

// ---- the reviewer's challenge ----

$("nonce-new").addEventListener("click", () => {
  generatedNonce = newNonce(crypto.getRandomValues(new Uint8Array(16)));
  $("nonce-value").textContent = generatedNonce;
  const row = $("nonce-row");
  row.querySelector(".copy")?.remove();
  if (navigator.clipboard) row.append(copyButton(generatedNonce, "Copy the nonce", live()));
  show("nonce-row", true);
  $("nonce-new-label").textContent = "Generate a new nonce";
  live().textContent = "New nonce generated";
  // A case on screen is checked again against the new nonce, offline, with the transactions already fetched.
  if (current?.meta?.txs) {
    const { text, dossier, meta } = current;
    const mine = generation;
    checkDossier(text, { txs: meta.txs, expectNonce: generatedNonce }).then((report) => {
      if (mine === generation) render(text, dossier, report, meta, { focus: false });
    });
  }
});

initVerifier().then(
  (v) => {
    verifierVersion = v;
    $("version").textContent = v;
    setStatus("Ready: verification runs in this page.", "ready");
    fromHash();
  },
  (e) => setStatus(`The verifier failed to load: ${e}`, "error"),
);
