// Case review page: opens a source-of-funds dossier (a file, pasted text, a case link's fragment, or a sample),
// fetches each transaction it names from a public node (or reads them from files the reviewer loads, offline), checks
// every claim here (WebAssembly), and shows the case. The DOM is written with textContent only, so nothing from a
// dossier is ever parsed as HTML. Nothing is stored; the only requests outside this site are the transaction lookups
// (fetchRawTx: the txid and nothing else) and, when the reviewer generates a nonce, the chain tip (fetchChainTip). The
// reviewer's nonce and its height (H₀) live in the challenge card's fields only.
import { initVerifier, checkDossier, dossierTxids, dossierPrevoutTxids, fetchRawTx, fetchChainTip, verifyReceipt, GRPC_WEB_ENDPOINTS, useNodes } from "../src/index.js";
import { memoText } from "../r/view.js";
import { el, copyButton } from "../r/ui.js";
import { badge, claimTableRows, factItems, listItem, download, showVerifierDigest } from "./ui.js";
import {
  SAMPLES, SAMPLE_FRAGMENT, EXCHANGE_SAMPLE, SAMPLE_CHALLENGE, NETWORK_NAME, readDossierInput, parseDossier, fetchProgress, caseVerdict, caseFacts, claimRows, flowSteps,
  nonceCheck, newNonce, caseSummaryText, reportForDownload, reportFileName, shortTxid, middle, noteLabel, KIND_LABEL, amountText,
  decisionSummary, claimNumbers, returnedText, heightInput, challengeRecordText, offlineText, txFile, utcText,
  depositAddressInput, depositCheck, depositLineText, nonceMask, maskNonces, funderChange,
} from "./view.js";

// A self-hosted copy names its own nodes (`scripts/build_site.sh --node`), and its CSP allows only them; the public
// site leaves this empty and uses the public nodes.
const ownNodes = document.querySelector('meta[name="zeceipt-nodes"]')?.content;
if (ownNodes) useNodes(JSON.parse(ownNodes));

// Each node gets 12 s, as on the receipt page: two hanging nodes would otherwise keep a reviewer waiting 40 s.
const PAGE_TIMEOUT_MS = 12_000;

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const live = () => $("copy-live");
const RESULT_PARTS = ["banner", "flow-card", "claims-card", "funders-card", "scope"];

let generation = 0; // bumps on every new dossier, so a late result for an earlier one is dropped
let current = null; // { text, dossier, report, meta }
let generatedAt = null; // when the nonce in the field was generated here (ISO), or null when it was typed
let generatedNonce = null; // the nonce generated here, to tell whether the field still holds it
let sampleNonce = null; // the sample's own nonce, when "Try it with the nonce the sample answered" filled it in
let offlineTxs = null; // txid → { hex, height: null }, from the files the reviewer loaded; null: ask the nodes
let verifierVersion = null;
let wasmSha256 = null;

function setStatus(text, state) {
  $("status").textContent = text;
  $("status").dataset.state = state;
}

function clearResult() {
  for (const id of RESULT_PARTS) show(id, false);
  $("banner").className = "result";
  $("verdict-live").textContent = "";
  $("nonce-result").textContent = "";
  $("print-meta").textContent = "";
  show("deposit-line", false);
  show("nonce-note", false);
  delete document.body.dataset.state;
  current = null;
}

/** The nonce the reviewer issued and its height, as the challenge card's fields hold them. */
const issued = () => ({ nonce: $("nonce-input").value.trim(), height: heightInput($("h0-input").value) });

/** The deposit address the reviewer assigned to this customer, as typed (depositAddressInput), or null. */
const assigned = () => depositAddressInput($("deposit-input").value);

/** Where the nonce in the field came from: generated here, the page's sample challenge, or typed (or pasted). */
function nonceSource(nonce) {
  if (nonce && nonce === generatedNonce) return "generated";
  if (nonce && nonce === sampleNonce) return "sample";
  return "typed";
}

/** The case fields a reviewer types in (they print, and go into the summary and the downloaded report). */
const caseFields = () => ({ reviewer: $("case-reviewer").value, caseId: $("case-id").value, date: $("case-date").value });

/**
 * Fetch every transaction the check needs, with progress, in the verifier's two rounds: the transactions the claims name,
 * then those whose outputs the origin transactions spend (the funders' addresses and values come from those outputs).
 * A node that cannot be reached gives way to the next; a node's "not found" answers for its network (as
 * fetchRawTxAnyNetwork has it), and the claims that need that transaction then say so. Any other failure stops the check.
 */
async function fetchAll(text, network, mine) {
  const endpoints = GRPC_WEB_ENDPOINTS[network] ?? [];
  if (!endpoints.length) throw new Error(`No public node serves the ${NETWORK_NAME[network] ?? network}: this page can check only mainnet and testnet dossiers online (load the transactions from files to check offline).`);
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

/** The verifier's options from the challenge card: the nonce the reviewer issued, and the height they issued it at. */
const checkOptions = (txs) => ({ txs, expectNonce: issued().nonce, issuedAtHeight: issued().height });

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
  // A reviewer who has not chosen a network for the challenge gets the dossier's.
  if (!$("nonce-input").value.trim() && ["main", "test"].includes(dossier?.network)) $("challenge-network").value = dossier.network;
  $("check").disabled = true;
  try {
    let got;
    if (offlineTxs) {
      // Offline: the files' transactions, without heights; no node is asked.
      got = { txs: { ...offlineTxs }, nodes: [] };
    } else {
      got = await fetchAll(text, dossier.network, mine);
      if (!got || mine !== generation) return;
    }
    setStatus("Checking every claim in this page…", "loading");
    const report = await checkDossier(text, checkOptions(got.txs));
    if (mine !== generation) return;
    const heights = Object.fromEntries(Object.entries(got.txs).map(([t, v]) => [t, v.height]));
    render(text, dossier, report, {
      source, txs: got.txs, checkedAt: new Date().toISOString(), nodes: got.nodes, heights, payments: receiptPayments(dossier, got.txs),
      offline: offlineTxs ? Object.keys(offlineTxs).length : null,
    });
  } catch (e) {
    if (mine !== generation) return;
    setStatus(`The check could not finish: ${String(e?.message ?? e)} Try again, or later.`, "error");
  } finally {
    if (mine === generation) $("check").disabled = false;
  }
}

/** The case on screen, checked again with the challenge card's nonce and height, offline (the same transactions). */
function recheck() {
  if (!current?.meta?.txs) return;
  const { text, dossier, meta } = current;
  const mine = generation;
  checkDossier(text, checkOptions(meta.txs)).then((report) => {
    if (mine === generation) render(text, dossier, report, meta, { focus: false });
  });
}

function render(text, dossier, report, meta, { focus = true } = {}) {
  const deposit = Array.isArray(report?.claims) ? depositCheck(report, assigned()) : null;
  const v = caseVerdict(report, dossier, { deposit, sample: Object.hasOwn(SAMPLES, meta.source ?? "") });
  const readable = Boolean(v.counts);
  const mine = issued();
  const nonce = readable ? nonceCheck(dossier, report, mine.nonce, { source: nonceSource(mine.nonce) }) : null;
  // Until the reviewer's nonce matches, the dossier's own nonce is shortened everywhere on the page (E04).
  const mask = readable ? nonceMask(dossier, nonce) : [];
  current = { text, dossier, report, meta: { ...meta, nonce, issued: mine.nonce, deposit, mask, verifier: verifierVersion, wasmSha256 } };

  $("headline").textContent = v.headline;
  $("verdict-sub").textContent = maskNonces(v.sub, mask);
  $("banner").className = `result ${v.tone}`;
  // The deposit address the reviewer assigned, when no verified payment pays it: amber, in the verdict.
  $("deposit-line").textContent = deposit?.state === "unpaid" ? depositLineText(deposit) : "";
  show("deposit-line", readable && deposit?.state === "unpaid");
  // Problems with the dossier as a whole (an nk that is not a key, say), which no single claim carries.
  $("banner-error").textContent = (report.problems ?? []).join(" ");
  show("banner-error", Boolean(report.problems?.length));
  // A parse error: one plain sentence above, the verifier's words in a fold.
  $("parse-raw").textContent = v.raw ?? "";
  show("parse-detail", Boolean(v.raw));
  $("offline-text").textContent = meta.offline != null ? `Checked ${offlineText(meta.offline)}.` : "";
  show("offline-line", readable && meta.offline != null);
  // A sample whose control claim is not yet matched to a nonce: one click shows it checked as its reviewer would.
  show("sample-nonce-row", readable && Object.hasOwn(SAMPLES, meta.source ?? "") && !report.controlled && (dossier?.claims ?? []).some((c) => c.type === "control"));
  $("facts").replaceChildren();
  show("nonce-line", false);
  show("case-actions", readable);
  show("case-fields", readable);
  show("decision-wrap", readable);
  if (readable) {
    $("decision").replaceChildren(...decisionSummary(dossier, report).map((d) => {
      const div = el("div", "fact");
      const dd = el("dd");
      dd.append(el("span", "decision-value", d.value), el("span", "decision-detail", d.detail));
      div.append(el("dt", "", d.key), dd);
      return div;
    }));
    $("facts").replaceChildren(...factItems(caseFacts(dossier, report, { ...meta, deposit }), { live: live(), wide: { "Dossier sha256": "Copy the dossier sha256" } }));
    $("nonce-line").textContent = nonce.text;
    $("nonce-line").dataset.state = nonce.state;
    show("nonce-line", true);
    $("nonce-note").textContent = nonce.note ?? "";
    show("nonce-note", Boolean(nonce.note));
    renderFlow(flowSteps(dossier, report, { ...meta, deposit, mask }));
    $("claims").tBodies[0].replaceChildren(...claimTableRows(claimRows(report, dossier, { deposit, mask })));
    renderFunders(dossier, report);
    renderScope(report);
    $("nonce-result").textContent = nonce.text;
    printFooter();
  }
  show("flow-card", readable);
  show("claims-card", readable);
  show("funders-card", readable && !$("funders").hidden);
  show("scope", readable);
  show("banner", true);
  $("inputs").open = false;
  document.body.dataset.state = "checked";
  setStatus(readable ? "Checked in this page." : "The dossier could not be read.", readable ? "checked" : "error");
  $("verdict-live").textContent = `${v.headline}. ${maskNonces(v.sub, mask)}`;
  if (!focus) return;
  $("banner").focus({ preventScroll: true });
  $("banner").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** The printed case's footer: when and how it was checked, the dossier's sha256 and the verifier's. */
function printFooter() {
  if (!current?.report) return;
  const { report, meta } = current;
  // The page footer's text, for the @page margin box (CSSOM, which the style-src policy does not restrict).
  document.documentElement.style.setProperty("--print-dossier", JSON.stringify(`Zeceipt case report · dossier sha256 ${report.dossier_sha256} · ${utcText(new Date().toISOString())}`));
  $("print-meta").textContent = `Checked ${meta.checkedAt ? utcText(meta.checkedAt) : ""} in the browser with ${verifierVersion ?? "the zeceipt verifier"} on ${location.host || "this page"}${meta.offline != null ? `, ${offlineText(meta.offline)}` : ""}. Report made ${utcText(new Date().toISOString())}. Verifier zeceipt_wasm_bg.wasm sha256 ${wasmSha256 ?? "not computed"}. Dossier sha256 ${report.dossier_sha256}. The notes' nullifiers are not printed.`;
}

/** A full identifier on paper, a short one with its full value in a tooltip on screen. */
function ident(full, short) {
  const span = el("span", "ident");
  const code = el("code", "screen-only", short);
  code.title = full;
  span.append(code, el("code", "print-full", full));
  return span;
}

function txLine(txid, height) {
  const p = el("p", "step-tx");
  p.append(document.createTextNode(height != null ? `Height ${height} · tx ` : "Height unknown · tx "), ident(txid, shortTxid(txid)));
  if (navigator.clipboard && txid) p.append(copyButton(txid, `Copy the transaction id ${shortTxid(txid)}`, live()));
  return p;
}

function noteChip(n) {
  const li = el("li", `chip-note${n.error ? " chip-bad" : ""}${n.reply ? " chip-reply" : ""}${n.untraced ? " chip-untraced" : ""}`);
  li.append(el("span", "chip-id", n.id), el("span", "chip-value", n.error ? "does not open" : n.value));
  if (n.reply && n.memo) li.append(el("span", "chip-memo", `memo “${n.memo}”`));
  if (n.untraced) li.append(el("span", "chip-flag", "not traced to an origin"));
  if (n.next) li.append(el("span", "chip-next", `spent in step ${n.next}`));
  li.setAttribute("aria-label", `${noteLabel(n)}${n.reply && n.memo ? `, memo ${n.memo}` : ""}${n.untraced ? ", not traced to an origin" : ""}${n.next ? `, spent in step ${n.next}` : ""}`);
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

function paymentChip(p) {
  const c = el("li", `chip-note chip-pay${p.transparent ? " chip-transparent" : ""}${p.assigned ? " chip-assigned" : ""}`);
  c.append(el("span", "chip-id", p.id), el("span", "chip-value", p.value));
  if (p.recipient) {
    const to = el("span", "chip-memo");
    // A transparent address is short enough to show whole; a unified address is shortened on screen.
    to.append(document.createTextNode("to "), p.transparent ? el("code", "", p.recipient) : ident(p.recipient, middle(p.recipient)));
    c.append(to);
  }
  if (p.memo) c.append(el("span", "chip-memo", `memo “${p.memo}”`));
  if (p.assigned) c.append(el("span", "chip-assigned-note", "pays the deposit address you assigned"));
  const what = p.transparent ? `Transparent payment, claim ${p.id}` : `Payment ${p.id}`;
  c.setAttribute("aria-label", `${what}: ${p.value}${p.recipient ? ` to ${p.recipient}` : ""}${p.memo ? `, memo ${p.memo}` : ""}${p.assigned ? ", pays the deposit address you assigned" : ""}`);
  return c;
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
    const shielded = s.payments.filter((p) => !p.transparent);
    const transparent = s.payments.filter((p) => p.transparent);
    if (shielded.length) body.append(group("Paid out", shielded.map(paymentChip)));
    if (transparent.length) body.append(group("Paid out (transparent)", transparent.map(paymentChip)));
    // What this transaction paid that the disclosed notes do not explain (spec §5.6).
    if (s.undisclosed_zat > 0) body.append(el("p", "step-flag", `Not fully explained: this transaction also spent at least ${amountText(s.undisclosed_zat, current?.report?.network)} from notes the dossier does not disclose.`));
    li.append(body);
    const edges = el("ul", "edges");
    edges.setAttribute("aria-label", `Claims in step ${s.number}`);
    for (const e of s.edges) {
      const row = el("li", `edge tone-${e.status}`);
      row.append(el("span", "edge-kind", `${claimNumbers(e.indices)} ${KIND_LABEL[e.kind]}`), el("span", "edge-label", e.label), badge(e.status));
      if (e.untraced?.length) row.append(el("span", "edge-flag", `${e.untraced.join(", ")} not traced to an origin`));
      edges.append(row);
    }
    li.append(edges);
    return li;
  });
  $("flow").replaceChildren(...items);
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
      div.append(el("p", "", `${t.length} transparent input${t.length === 1 ? "" : "s"} funded this transaction. Each address and value is read from the output the input spends, in the previous transaction; who holds an address is not proven here, unless the holder paid it there in this dossier.`));
      const table = el("table", "kv funders-table");
      table.append(...t.map((i, k) => {
        const tr = el("tr");
        tr.dataset.key = `Input ${k + 1}`;
        const td = el("td");
        td.append(el("code", "", i.address ?? "address not known (the previous transaction was not found, or its output is not a standard one)"));
        if (i.address && navigator.clipboard) td.append(copyButton(i.address, `Copy the address of input ${k + 1}`, live()));
        const [ptx, pout] = i.prevout.split(":");
        const prev = el("span", "prevout");
        prev.append(document.createTextNode(`${i.value_zat != null ? `${amountText(i.value_zat, report.network)}, ` : ""}spends `), ident(`${ptx}:${pout}`, `${shortTxid(ptx)}:${pout}`));
        td.append(prev);
        if (i.paid_in_claim != null) td.append(el("span", "returned", returnedText([i.paid_in_claim])));
        tr.append(el("td", "", `Input ${k + 1}`), td);
        return tr;
      }));
      div.append(table);
      // Part of the inputs that went back to the funder: the holder received the rest (less the fee).
      for (const ch of funderChange(c.details ?? [])) {
        div.append(el("p", "funder-change", `Change: ${amountText(ch.value_zat, report.network)} of the inputs went back to ${ch.address} (output ${ch.output}), the funder's own address${n?.value_zat != null ? `; the holder received ${amountText(n.value_zat, report.network)} in ${noteId}` : ""}.`));
      }
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

async function loadSample(name = SAMPLE_FRAGMENT) {
  setStatus("Loading the sample dossier…", "loading");
  const mine = generation;
  const res = await fetch(SAMPLES[name], { cache: "no-store" });
  if (!res.ok) { setStatus(`The sample could not be loaded (HTTP ${res.status}).`, "error"); return; }
  const text = await res.text();
  if (mine !== generation) return;
  await check(text, name);
}

async function open(raw, source) {
  const r = readDossierInput(raw);
  if (r.sample) return loadSample(r.sample);
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
  open(`#${h}`, "link");
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

// ---- offline: the transactions from files ----

$("tx-files").addEventListener("change", async (ev) => {
  const files = [...ev.target.files];
  if (!files.length) return;
  const txs = { ...(offlineTxs ?? {}) };
  const skipped = [];
  for (const f of files) {
    const t = txFile(f.name, await f.text());
    if (t.error) skipped.push(t.error);
    else txs[t.txid] = { hex: t.hex, height: null, mempool: false };
  }
  ev.target.value = "";
  const n = Object.keys(txs).length;
  offlineTxs = n ? txs : null;
  $("tx-files-status").textContent = `${n ? `${n} transaction${n === 1 ? "" : "s"} loaded (${Object.keys(txs).map(shortTxid).join(", ")}): dossiers are checked offline, and inclusion in the chain is not checked.` : "No transaction loaded."}${skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""}`;
  show("tx-files-clear", Boolean(offlineTxs));
  // A case on screen is checked again against the files.
  if (current?.text && offlineTxs) await check(current.text, current.meta.source);
});

async function goOnline() {
  offlineTxs = null;
  $("tx-files-status").textContent = "The files were forgotten: dossiers are checked against a public node.";
  show("tx-files-clear", false);
  if (current?.text) await check(current.text, current.meta.source);
}
$("tx-files-clear").addEventListener("click", goOnline);
$("retry-online").addEventListener("click", goOnline);

// ---- actions ----

$("download").addEventListener("click", () => {
  if (!current?.report) return;
  const name = reportFileName(current.report);
  const hideNullifiers = $("hide-nullifiers").checked;
  download(JSON.stringify(reportForDownload(current.report, { ...current.meta, caseFields: caseFields(), hideNullifiers }), null, 2) + "\n", name);
  live().textContent = `Report downloaded as ${name}${hideNullifiers ? ", without the notes' nullifiers" : ""}`;
});
$("print").addEventListener("click", () => { printFooter(); window.print(); });
window.addEventListener("beforeprint", printFooter);
$("copy-summary").addEventListener("click", async () => {
  if (!current?.report) return;
  let said = "Case summary copied";
  try { await navigator.clipboard.writeText(caseSummaryText(current.dossier, current.report, { ...current.meta, caseFields: caseFields() })); }
  catch { said = "Copy failed: the browser refused the clipboard"; }
  live().textContent = said;
});

// ---- the reviewer's challenge ----

$("nonce-new").addEventListener("click", async () => {
  generatedNonce = newNonce(crypto.getRandomValues(new Uint8Array(16)));
  generatedAt = new Date().toISOString();
  $("nonce-input").value = generatedNonce;
  $("h0-input").value = "";
  $("nonce-new-label").textContent = "Generate a new nonce";
  live().textContent = "New nonce generated";
  const network = $("challenge-network").value;
  const nonce = generatedNonce;
  $("h0-status").textContent = `Asking a ${NETWORK_NAME[network]} node for the chain's height…`;
  try {
    const tip = await fetchChainTip(network, GRPC_WEB_ENDPOINTS[network], { timeoutMs: PAGE_TIMEOUT_MS });
    if (nonce !== generatedNonce) return;
    $("h0-input").value = String(tip.height);
    $("h0-status").textContent = `Issued at height ${tip.height} (H₀, ${NETWORK_NAME[network]}), ${utcText(generatedAt)}. A control transaction mined before it fails.`;
  } catch (e) {
    if (nonce !== generatedNonce) return;
    $("h0-status").textContent = `The chain's height could not be asked (${String(e?.message ?? e)}): enter the height you issued the nonce at yourself.`;
  }
  // A case on screen is checked again against the new nonce and height, offline, with the transactions already fetched.
  recheck();
});

// Typing in the nonce or the height checks the case on screen again, once the typing pauses.
let typing = null;
for (const id of ["nonce-input", "h0-input"]) $(id).addEventListener("input", () => {
  if ($("nonce-input").value.trim() !== generatedNonce) { generatedAt = null; generatedNonce = null; }
  if ($("nonce-input").value.trim() !== sampleNonce) sampleNonce = null;
  const h = $("h0-input").value.trim();
  $("h0-status").textContent = h && heightInput(h) === null ? "The height is not a whole number: it is ignored." : "";
  clearTimeout(typing);
  typing = setTimeout(recheck, 350);
});

// The deposit address the reviewer assigned: checked against the case on screen as it is typed (no new lookup; the
// verifier's report already names each transparent payment's address).
let typingDeposit = null;
$("deposit-input").addEventListener("input", () => {
  const a = assigned();
  $("deposit-status").textContent = a?.error ?? (a ? `A ${a.kind === "tex" ? "TEX (ZIP 320)" : "transparent"} address on ${NETWORK_NAME[a.network] ?? a.network}.` : "");
  clearTimeout(typingDeposit);
  typingDeposit = setTimeout(() => { if (current?.report) render(current.text, current.dossier, current.report, current.meta, { focus: false }); }, 250);
});

$("copy-challenge").addEventListener("click", async () => {
  const { nonce, height } = issued();
  let said = "Challenge copied for the case file";
  try {
    await navigator.clipboard.writeText(challengeRecordText({ nonce, height, network: $("challenge-network").value, issuedAt: generatedAt, now: new Date().toISOString(), depositAddress: assigned()?.error ? "" : $("deposit-input").value }));
  } catch { said = "Copy failed: the browser refused the clipboard"; }
  live().textContent = said;
});

/** A sample as its reviewer checked it: the nonce they issued and the height then, filled in; the sample opened. */
async function sampleChallenge(name) {
  const c = SAMPLE_CHALLENGE[name];
  $("nonce-input").value = c.nonce;
  $("h0-input").value = String(c.height);
  $("challenge-network").value = c.network;
  generatedAt = null;
  generatedNonce = null;
  sampleNonce = c.nonce;
  $("h0-status").textContent = `The sample's challenge: nonce ${c.nonce}, issued at height ${c.height} on ${NETWORK_NAME[c.network]}.`;
  if (current?.meta?.txs && current.meta.source === name) recheck();
  else { dropFragment(); await loadSample(name); }
}
const shownSample = () => (Object.hasOwn(SAMPLES, current?.meta?.source ?? "") ? current.meta.source : SAMPLE_FRAGMENT);
$("sample-nonce").addEventListener("click", () => sampleChallenge(shownSample()));
$("sample-challenge").addEventListener("click", () => sampleChallenge(EXCHANGE_SAMPLE));
$("sample-exchange").addEventListener("click", () => { dropFragment(); loadSample(EXCHANGE_SAMPLE); });

initVerifier().then(
  (v) => {
    verifierVersion = v;
    $("version").textContent = v;
    setStatus("Ready: verification runs in this page.", "ready");
    fromHash();
    showVerifierDigest($("wasm-sha")).then((sha) => { wasmSha256 = sha; if (current) { current.meta.wasmSha256 = sha; printFooter(); } });
  },
  (e) => setStatus(`The verifier failed to load: ${e}`, "error"),
);
