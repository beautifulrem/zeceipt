// Case review page: opens a source-of-funds dossier (a file, pasted text, a case link's fragment, or a sample),
// fetches each transaction it names from a public node (or reads them from files the reviewer loads, offline), checks
// every claim here (WebAssembly), and shows the case. The DOM is written with textContent only, so nothing from a
// dossier is ever parsed as HTML. Nothing is stored; the only requests outside this site are the transaction lookups
// (fetchRawTx: the txid and nothing else), the block a control's beacon names (fetchBlockId: its height), and, when the
// reviewer generates a nonce, the chain tip (fetchChainTip, and fetchBlockId for a beacon nonce). The reviewer's nonce,
// its height (H₀) and the deposit address they assigned live in the challenge panel's fields only.
import { initVerifier, checkDossier, dossierTxids, dossierPrevoutTxids, fetchRawTx, fetchChainTip, fetchBlockId, verifyReceipt, GRPC_WEB_ENDPOINTS, useNodes, mapLimit } from "../src/index.js";
import { memoText, nodeHost, heightText } from "../r/view.js";
import { el, idEl, amountEl } from "../r/ui.js";
import { badge, tip, claimTableRows, factItems, listItem, limitItem, download, showVerifierDigest, linkSelection } from "./ui.js";
import { renderFlowGraph } from "./flow-svg.js";
import {
  SAMPLES, SAMPLE_FRAGMENT, EXCHANGE_SAMPLE, SAMPLE_CHALLENGE, NETWORK_NAME, beaconOf, beaconNonce, blockTimeText, depositAddressStatus, readDossierInput, parseDossier, fetchProgress, caseVerdict, caseFacts, claimRows, flowSteps,
  nonceCheck, newNonce, caseSummaryText, reportForDownload, reportFileName, shortTxid, KIND_LABEL, amountText, exceptionItems,
  decisionSummary, claimNumbers, returnedText, heightInput, challengeRecordText, offlineText, txFile, utcText,
  depositAddressInput, depositCheck, depositLineText, nonceMask, maskNonces, funderChange,
} from "./view.js";

// A self-hosted copy names its own nodes (`scripts/build_site.sh --node`), and its CSP allows only them; the public
// site leaves this empty and uses the public nodes.
const ownNodes = document.querySelector('meta[name="zeceipt-nodes"]')?.content;
if (ownNodes) useNodes(JSON.parse(ownNodes));

// Each node gets 12 s, as on the receipt page: two hanging nodes would otherwise keep a reviewer waiting 40 s.
const PAGE_TIMEOUT_MS = 12_000;
// Lookups in flight at once (FE10): a dossier of 12 transactions no longer waits for each in turn.
const CONCURRENCY = 3;

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const live = () => $("copy-live");
const RESULT_PARTS = ["banner", "case-tabs", "panel-summary", "flow-card", "claims-card", "raw-card", "funders-card", "scope", "reference", "record-card"];

let generation = 0; // bumps on every new dossier, so a late result for an earlier one is dropped
let current = null; // { text, dossier, report, meta }
let generatedAt = null; // when the nonce in the field was generated here (ISO), or null when it was typed
let generatedNonce = null; // the nonce generated here, to tell whether the field still holds it
let sampleNonce = null; // the sample's own nonce, when "Use the sample's nonce" filled it in
let offlineTxs = null; // txid → { hex, height: null }, from the files the reviewer loaded; null: ask the nodes
let verifierVersion = null;
let wasmSha256 = null;
let fileName = null; // the dossier file's name, when it came from a file
const asked = { tx: 0, block: 0, tip: 0, hosts: new Set() }; // what this page has asked the nodes, for the privacy panel

/** The status line under the title: quiet, not a live region (FE19); the verdict and the actions are announced. */
function setStatus(text, state) {
  $("status").textContent = text;
  $("status").dataset.state = state;
}

function clearResult() {
  for (const id of RESULT_PARTS) show(id, false);
  $("banner").className = "result";
  $("verdict-live").textContent = "";
  $("print-meta").textContent = "";
  show("deposit-line", false);
  show("nonce-note", false);
  delete document.body.dataset.state;
  current = null;
  renderLog();
}

/** The nonce the reviewer issued and its height, as the challenge panel's fields hold them. */
const issued = () => ({ nonce: $("nonce-input").value.trim(), height: heightInput($("h0-input").value) });

/** The deposit address the reviewer assigned to this customer, as typed (depositAddressInput), or null. */
const assigned = () => depositAddressInput($("deposit-input").value);

/** The address the verifier is given to check (spec §7.2): what was typed, when it is an address; "" otherwise. */
const expectedDeposit = () => { const a = assigned(); return a && !a.error ? a.address : ""; };

/** Where the nonce in the field came from: generated here, the page's sample challenge, or typed (or pasted). */
function nonceSource(nonce) {
  if (nonce && nonce === generatedNonce) return "generated";
  if (nonce && nonce === sampleNonce) return "sample";
  return "typed";
}

/** The case fields a reviewer types in (they print, and go into the summary and the downloaded report). */
const caseFields = () => ({ reviewer: $("case-reviewer").value, caseId: $("case-id").value, date: $("case-date").value });

// ---- what the page has asked: the privacy panel ----

function countAsk(kind, endpoint) {
  asked[kind]++;
  if (endpoint) asked.hosts.add(nodeHost(endpoint));
  renderPrivacy();
}
function renderPrivacy(offlineFiles = null) {
  const parts = [];
  if (asked.tx) parts.push(`${asked.tx} transaction${asked.tx === 1 ? "" : "s"}`);
  if (asked.block) parts.push(`${asked.block} block${asked.block === 1 ? "" : "s"}`);
  if (asked.tip) parts.push(`${asked.tip} chain height${asked.tip === 1 ? "" : "s"}`);
  const hosts = [...asked.hosts].join(", ");
  $("privacy-lookups").textContent = parts.length ? `${parts.join(", ")}${hosts ? `, from ${hosts}` : ""}` : offlineFiles != null ? `None: checked from ${offlineFiles} file${offlineFiles === 1 ? "" : "s"}` : "None yet";
}

// ---- loading: a placeholder of the verdict and one line per transaction (FE10) ----

const progressRows = new Map();
function progressStart() {
  progressRows.clear();
  $("progress-list").replaceChildren();
  $("progress-count").textContent = "";
  show("progress", true);
}
function progressRow(txid, round) {
  let li = progressRows.get(txid);
  if (!li) {
    li = el("li");
    li.dataset.state = "wait";
    const mark = el("span", "p-mark");
    mark.setAttribute("aria-hidden", "true");
    li.append(mark, idEl(txid, { kind: "tx", copy: false, tail: 8 }), el("span", "p-note", round ? "funder's transaction" : "waiting"));
    $("progress-list").append(li);
    progressRows.set(txid, li);
  }
  return li;
}
function progressSet(txid, state, note) {
  const li = progressRows.get(txid);
  if (!li) return;
  li.dataset.state = state;
  li.lastChild.textContent = note;
  const done = [...progressRows.values()].filter((x) => x.dataset.state === "done" || x.dataset.state === "missing").length;
  $("progress-count").textContent = `${done} of ${progressRows.size} fetched`;
}

/**
 * Fetch every transaction the check needs, three at a time, in the verifier's two rounds: the transactions the claims
 * name, then those whose outputs the origin transactions spend (the funders' addresses and values come from those
 * outputs). A node that cannot be reached gives way to the next; a node's "not found" answers for its network (as
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
    for (const t of ids) progressRow(t, round);
    await mapLimit(ids, CONCURRENCY, async (txid, i) => {
      let lastErr = null;
      let found = false;
      for (let k = 0; k < endpoints.length && !found; k++) {
        const ep = endpoints[(preferred + k) % endpoints.length];
        if (mine !== generation) return;
        setStatus(fetchProgress(i, ids.length, ep, round), "loading");
        progressSet(txid, "busy", nodeHost(ep));
        try {
          countAsk("tx", ep);
          const r = await fetchRawTx(txid, network, [ep], { timeoutMs: PAGE_TIMEOUT_MS });
          txs[txid] = { hex: r.hex, height: r.chain.status === "mined" ? r.chain.height : null, mempool: r.chain.status === "mempool" };
          used.add(ep);
          preferred = endpoints.indexOf(ep);
          found = true;
          progressSet(txid, "done", txs[txid].height != null ? `height ${heightText(txs[txid].height)}` : r.chain.status === "mempool" ? "in the mempool" : "found");
        } catch (e) {
          lastErr = e;
          if (e.code === "not_found") break;
        }
      }
      if (!found) {
        if (lastErr?.code !== "not_found") throw lastErr ?? new Error("the nodes could not be reached");
        progressSet(txid, "missing", "not found");
      }
    });
    if (mine !== generation) return null;
  }
  return { txs, nodes: [...used] };
}

/** What each deposit's receipt opens (recipient, value, memo), for the transactions; the claim itself is checked by the verifier. */
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

/**
 * The verifier's options from the challenge panel: the nonce the reviewer issued, the height they issued it at and the
 * deposit address they assigned; and the blocks the dossier's beacons name, as looked up (none offline).
 */
const checkOptions = (txs, beacons) => ({ txs, expectNonce: issued().nonce, issuedAtHeight: issued().height, expectDepositAddress: expectedDeposit(), beacons: beacons ?? {} });

/**
 * The blocks the dossier's beacon nonces name (spec §7.4), from the node, as `{ height: { hash, time } }`: the
 * verifier compares each with the nonce. A block that cannot be looked up is left out, and the control claim then
 * says it was not checked.
 */
async function lookUpBeacons(dossier, network, mine) {
  const heights = [...new Set((dossier?.claims ?? []).filter((c) => c.type === "control").map((c) => beaconOf(c.nonce)?.height).filter((h) => h != null))];
  const out = {};
  for (const h of heights) {
    if (mine !== generation) return null;
    setStatus(`Looking up block ${heightText(h)}, whose hash the control claim answers…`, "loading");
    try {
      countAsk("block", GRPC_WEB_ENDPOINTS[network]?.[0]);
      const id = await fetchBlockId(network, h, GRPC_WEB_ENDPOINTS[network], { timeoutMs: PAGE_TIMEOUT_MS });
      out[h] = { hash: id.hash, time: id.time };
    } catch { /* not looked up: the control claim says so */ }
  }
  return out;
}

async function check(text, source) {
  const mine = ++generation;
  clearResult();
  const dossier = parseDossier(text);
  try {
    dossierTxids(text);
  } catch (e) {
    show("progress", false);
    render(text, dossier, { all_verified: false, stage: "parse", error: String(e).replace(/^Error: /, "") }, { source });
    return;
  }
  // A reviewer who has not chosen a network for the challenge gets the dossier's.
  if (!$("nonce-input").value.trim() && ["main", "test"].includes(dossier?.network)) $("challenge-network").value = dossier.network;
  $("check").disabled = true;
  $("inputs").open = false;
  setInputsSummary(text, null);
  try {
    let got;
    let beacons = null;
    if (offlineTxs) {
      // Offline: the files' transactions, without heights; no node is asked (a beacon's block neither).
      got = { txs: { ...offlineTxs }, nodes: [] };
    } else {
      progressStart();
      live().textContent = "Checking the dossier against a public node";
      got = await fetchAll(text, dossier.network, mine);
      if (!got || mine !== generation) return;
      beacons = await lookUpBeacons(dossier, dossier.network, mine);
      if (!beacons || mine !== generation) return;
    }
    setStatus("Checking every claim in this page…", "loading");
    const report = await checkDossier(text, checkOptions(got.txs, beacons));
    if (mine !== generation) return;
    const heights = Object.fromEntries(Object.entries(got.txs).map(([t, v]) => [t, v.height]));
    render(text, dossier, report, {
      source, txs: got.txs, beacons, checkedAt: new Date().toISOString(), nodes: got.nodes, heights, payments: receiptPayments(dossier, got.txs),
      offline: offlineTxs ? Object.keys(offlineTxs).length : null,
    });
  } catch (e) {
    if (mine !== generation) return;
    show("progress", false);
    $("inputs").open = true;
    setStatus(`The check could not finish: ${String(e?.message ?? e)} Try again, or later.`, "error");
    live().textContent = "The check could not finish";
  } finally {
    if (mine === generation) $("check").disabled = false;
  }
}

/**
 * The case on screen, checked again with the challenge panel's nonce, height and deposit address, offline (the same
 * transactions and blocks).
 */
function recheck() {
  if (!current?.meta?.txs) { renderLog(); return; }
  const { text, dossier, meta } = current;
  const mine = generation;
  checkDossier(text, checkOptions(meta.txs, meta.beacons)).then((report) => {
    if (mine === generation) render(text, dossier, report, meta, { focus: false });
  });
}

/** The collapsed input line: the file's name (or how it came), and the dossier's sha256. */
function setInputsSummary(text, sha) {
  $("inputs-name").textContent = fileName ?? "Dossier";
  $("inputs-sha").textContent = sha ? `sha256 ${sha.slice(0, 8)}…${sha.slice(-6)}` : "";
}

function render(text, dossier, report, meta, { focus = true } = {}) {
  show("progress", false);
  const deposit = Array.isArray(report?.claims) ? depositCheck(report, assigned()) : null;
  const v = caseVerdict(report, dossier, { deposit, sample: Object.hasOwn(SAMPLES, meta.source ?? "") ? meta.source : null });
  const readable = Boolean(v.counts);
  const mine = issued();
  const nonce = readable ? nonceCheck(dossier, report, mine.nonce, { source: nonceSource(mine.nonce) }) : null;
  // Until the reviewer's nonce matches, the dossier's own nonce is shortened everywhere on the page (E04).
  const mask = readable ? nonceMask(dossier, nonce) : [];
  current = { text, dossier, report, meta: { ...meta, nonce, issued: mine.nonce, deposit, mask, verifier: verifierVersion, wasmSha256 } };
  const network = report?.network ?? dossier?.network;

  // The verdict: the result, the count, one line; the reasons and the exceptions in a fold.
  $("headline").textContent = v.headline;
  $("verdict-count").textContent = v.count ?? "";
  $("verdict-line").textContent = maskNonces(v.line ?? v.sub, mask);
  $("verdict-sub").textContent = maskNonces(v.sub, mask);
  $("banner").className = `result ${v.tone}`;
  const exceptions = readable ? exceptionItems(report, dossier, { deposit, mask }) : [];
  $("exceptions").replaceChildren(...exceptions.map((x) => {
    const li = el("li");
    const go = el("button", "linkish exc-link", `#${x.number} ${x.kind}`);
    go.type = "button";
    go.addEventListener("click", () => goToClaim(x.number));
    li.append(go, el("span", "", maskNonces(x.text, mask)));
    return li;
  }));
  show("verdict-why", readable && (v.sub !== v.line || exceptions.length > 0));
  // Problems with the dossier as a whole (an nk that is not a key, say), which no single claim carries; those the
  // verdict already states are not repeated.
  const problems = (report.problems ?? []).filter((p) => !String(v.sub ?? "").includes(p));
  $("banner-error").textContent = problems.join(" ");
  show("banner-error", problems.length > 0);
  // A parse error: one plain sentence above, the verifier's words in a fold.
  $("parse-raw").textContent = v.raw ?? "";
  show("parse-detail", Boolean(v.raw));

  // One callout at most, the most important (deposit address not paid, then offline, then a typed nonce, then the
  // sample's challenge); every other note is in the challenge log.
  $("deposit-line").textContent = deposit?.state === "unpaid" ? depositLineText(deposit) : "";
  $("offline-text").textContent = meta.offline != null ? `Checked ${offlineText(meta.offline)}.` : "";
  $("nonce-note").textContent = nonce?.note ?? "";
  const sampleRow = readable && Object.hasOwn(SAMPLE_CHALLENGE, meta.source ?? "") && !report.controlled && (dossier?.claims ?? []).some((c) => c.type === "control");
  const slot = !readable ? null : deposit?.state === "unpaid" ? "deposit-line" : meta.offline != null ? "offline-line" : nonce?.note ? "nonce-note" : sampleRow ? "sample-nonce-row" : null;
  for (const id of ["deposit-line", "offline-line", "nonce-note", "sample-nonce-row"]) show(id, slot === id);
  if (sampleRow) $("sample-nonce-row").querySelector(".callout-text").textContent = meta.source === EXCHANGE_SAMPLE ? "This sample's control claim answers the exchange's challenge." : "This sample's control claim answers its reviewer's challenge.";

  show("decision-wrap", readable);
  show("case-actions", readable);
  show("case-fields", readable);
  show("hide-nf", readable);
  show("record-card", readable);
  $("facts").replaceChildren();
  if (readable) {
    renderFigures(decisionSummary(dossier, report), network);
    $("facts").replaceChildren(...factItems(caseFacts(dossier, report, { ...meta, deposit }), { live: live(), network, ids: { "Dossier sha256": { kind: "hash", label: "dossier sha256", tail: 8 } } }));
    setInputsSummary(text, report.dossier_sha256);
    const steps = flowSteps(dossier, report, { ...meta, deposit, mask });
    current.steps = steps;
    renderFlow(steps, network);
    renderGraph();
    const rows = claimRows(report, dossier, { deposit, mask, heights: meta.heights });
    $("claims").tBodies[0].replaceChildren(...claimTableRows(rows, { network, live: live() }));
    $("flow-count").textContent = String(steps.length);
    $("claims-count").textContent = String(rows.length);
    $("exceptions-count").textContent = String(exceptions.length);
    renderFunders(dossier, report);
    renderScope(report);
    $("raw-json").textContent = maskNonces(JSON.stringify(report, null, 2), mask);
    printFooter();
    for (const id of ["case-tabs", "panel-summary", "flow-card", "claims-card", "raw-card", "scope", "reference"]) show(id, true);
    show("funders-card", !$("funders").hidden);
    selectTab(currentTab, false);
  }
  renderLog();
  renderPrivacy(meta.offline);
  show("banner", true);
  $("inputs").open = false;
  document.body.dataset.state = "checked";
  setStatus(readable ? `Checked in this page${meta.checkedAt ? `, ${utcText(meta.checkedAt)}` : ""}.` : "The dossier could not be read.", readable ? "checked" : "error");
  $("verdict-live").textContent = `${v.headline}.${v.count ? ` ${v.count}.` : ""} ${maskNonces(v.line ?? v.sub, mask)}`;
  if (!focus) return;
  $("banner").focus({ preventScroll: true });
  $("banner").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** The stat row (FE01): five figures, each a label, a value and a hint holding the sentence behind it. */
function renderFigures(items, network) {
  $("decision").replaceChildren(...items.map((d) => {
    const div = el("div", "kpi");
    if (d.tone) div.dataset.tone = d.tone;
    const dt = el("dt");
    const mark = el("span", "kpi-mark");
    mark.setAttribute("aria-hidden", "true");
    dt.append(mark, el("span", "kpi-label", d.key), tip(d.detail, `About ${d.key.toLowerCase()}`, { end: d.key === "Claims" || d.key === "Control" }));
    const dd = el("dd");
    const value = el("span", "kpi-value");
    if (d.zat !== undefined) value.append(amountEl(d.zat, network, { atLeast: d.atLeast }));
    else value.textContent = d.value;
    dd.append(value);
    if (d.sub) dd.append(el("span", "kpi-sub", d.sub));
    div.append(dt, dd);
    return div;
  }));
}

/** The printed case's footer: when and how it was checked, the dossier's sha256 and the verifier's. */
function printFooter() {
  if (!current?.report) return;
  const { report, meta } = current;
  // The page footer's text, for the @page margin box (CSSOM, which the style-src policy does not restrict).
  document.documentElement.style.setProperty("--print-dossier", JSON.stringify(`Zeceipt case report · dossier sha256 ${report.dossier_sha256} · ${utcText(new Date().toISOString())}`));
  $("print-meta").textContent = `Checked ${meta.checkedAt ? utcText(meta.checkedAt) : ""} in the browser with ${verifierVersion ?? "the zeceipt verifier"} on ${location.host || "this page"}${meta.offline != null ? `, ${offlineText(meta.offline)}` : ""}. Report made ${utcText(new Date().toISOString())}. Verifier zeceipt_wasm_bg.wasm sha256 ${wasmSha256 ?? "not computed"}. Dossier sha256 ${report.dossier_sha256}. The notes' nullifiers are not printed.`;
}

// ---- tabs (Summary, Transactions, Claims, Raw) ----

const TABS = ["summary", "flow", "claims", "raw"];
const PANEL = { summary: "panel-summary", flow: "flow-card", claims: "claims-card", raw: "raw-card" };
let currentTab = "summary";
function selectTab(name, focus = true) {
  currentTab = name;
  for (const t of TABS) {
    const on = t === name;
    const tab = $(`tab-${t}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(PANEL[t]).classList.toggle("is-inactive", !on);
  }
  if (focus) $(`tab-${name}`).focus();
  if (name === "summary") renderGraph();
}
for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => selectTab(t, false));
$("case-tabs").addEventListener("keydown", (e) => {
  const i = TABS.indexOf(currentTab);
  const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectTab(TABS[next]);
});

/** A claim from the verdict's exceptions: the Claims tab, that row, focused. */
function goToClaim(n) {
  selectTab("claims", false);
  const row = $(`claim-${n}`);
  if (!row) return;
  for (const r of document.querySelectorAll(".claims-table tr.is-target")) r.classList.remove("is-target");
  row.classList.add("is-target");
  row.tabIndex = -1;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// The claims table's filter: every claim, or only those that did not verify or carry a flag.
for (const [id, only] of [["claims-all", false], ["claims-exceptions", true]]) {
  $(id).addEventListener("click", () => {
    $("claims").classList.toggle("only-exceptions", only);
    $("claims-all").setAttribute("aria-pressed", String(!only));
    $("claims-exceptions").setAttribute("aria-pressed", String(only));
  });
}

$("copy-raw").addEventListener("click", async () => {
  let said = "Report JSON copied";
  try { await navigator.clipboard.writeText($("raw-json").textContent); }
  catch { said = "Copy failed: the browser refused the clipboard"; }
  live().textContent = said;
});

// ---- the diagram and the transactions ----

let graphWidth = 0;
function renderGraph() {
  if (!current?.steps || $("panel-summary").classList.contains("is-inactive") || $("panel-summary").hidden) return;
  graphWidth = $("flow-graph").clientWidth;
  renderFlowGraph($("flow-graph"), current.steps, { network: current.report?.network ?? current.dossier?.network });
}
new ResizeObserver(() => { if (current?.steps && Math.abs($("flow-graph").clientWidth - graphWidth) > 24) renderGraph(); }).observe($("flow-graph"));

/** A note in a transaction's list: its id, its amount, and where it came from or goes. */
function noteChip(n, network, { side }) {
  const li = el("li", `chip-note${n.error ? " chip-bad" : ""}${n.reply ? " chip-reply" : ""}${n.untraced || n.unexplained ? " chip-untraced" : ""}`);
  li.dataset.key = `note:${n.id}`;
  const main = el("span", "chip-main");
  if (n.reply) main.append(document.createTextNode("reply note"));
  else if (side === "in" && n.from) main.append(document.createTextNode(`from step ${n.from}`));
  li.append(el("span", "chip-id", n.id), main);
  const value = el("span", "chip-value");
  if (n.error) value.textContent = "does not open";
  else value.append(amountEl(n.value_zat, network));
  li.append(value);
  if (n.memo) li.append(el("span", "chip-memo", `memo “${n.memo}”`));
  if (n.untraced) li.append(el("span", "chip-flag", "not traced to an origin"));
  if (n.unexplained) li.append(el("span", "chip-flag", "names no source"));
  if (side === "out") li.append(el("span", "chip-next", n.next ? `spent in step ${n.next}` : "not spent in this dossier"));
  return li;
}

function paymentChip(p, network) {
  const c = el("li", `chip-note chip-pay${p.transparent ? " chip-transparent" : ""}${p.assigned ? " chip-assigned" : ""}`);
  if (p.recipient) c.dataset.key = `addr:${p.recipient}`;
  const main = el("span", "chip-main");
  if (p.recipient) main.append(document.createTextNode("to "), idEl(p.recipient, { kind: "address", network, live: live(), key: `addr:${p.recipient}`, label: "recipient" }));
  else main.append(document.createTextNode("payment"));
  const value = el("span", "chip-value");
  value.append(amountEl(p.value_zat, network));
  c.append(el("span", "chip-id", p.id), main, value);
  if (p.memo) c.append(el("span", "chip-memo", `memo “${p.memo}”`));
  if (p.assigned) c.append(el("span", "chip-assigned-note", "pays the deposit address you assigned"));
  return c;
}

/** An origin's sources, in the transaction's "in" list: its transparent funders, or an undisclosed shielded sender. */
function sourceChips(s, network) {
  const out = [];
  for (const f of s.funding) {
    const t = f.funding?.transparent_inputs ?? [];
    if (!f.funding) { out.push(el("li", "chip-note chip-untraced", "Funding not established: the claim did not verify.")); continue; }
    if (f.funding.from_disclosed?.length) {
      for (const id of f.funding.from_disclosed) {
        const li = el("li", "chip-note");
        li.dataset.key = `note:${id}`;
        li.append(el("span", "chip-id", id), el("span", "chip-main", "a disclosed note"), el("span", "chip-value"));
        out.push(li);
      }
      continue;
    }
    if (t.length) {
      t.forEach((i, k) => {
        const li = el("li", "chip-note chip-transparent");
        if (i.address) li.dataset.key = `addr:${i.address}`;
        const main = el("span", "chip-main");
        main.append(i.address ? idEl(i.address, { kind: "address", network, live: live(), key: `addr:${i.address}`, label: `address of input ${k + 1}` }) : document.createTextNode("address not known"));
        const value = el("span", "chip-value");
        value.append(amountEl(i.value_zat ?? null, network));
        li.append(el("span", "chip-id", `in ${k + 1}`), main, value);
        if (i.paid_in_claim != null) li.append(el("span", "chip-memo", returnedText([i.paid_in_claim])));
        out.push(li);
      });
      for (const ch of funderChange(f.details ?? [])) {
        const li = el("li", "chip-note");
        const main = el("span", "chip-main");
        main.append(document.createTextNode("change back to "), idEl(ch.address, { kind: "address", network, live: live(), key: `addr:${ch.address}`, label: "funder's address" }));
        const value = el("span", "chip-value");
        value.append(amountEl(-ch.value_zat, network));
        li.append(el("span", "chip-id", `out ${ch.output}`), main, value);
        out.push(li);
      }
    } else {
      const li = el("li", "chip-note chip-untraced");
      li.append(el("span", "chip-id", "•••"), el("span", "chip-main", `an undisclosed shielded sender (${f.funding.shielded_actions ?? 0} shielded action${f.funding.shielded_actions === 1 ? "" : "s"})`), el("span", "chip-value"));
      out.push(li);
    }
  }
  return out;
}

function renderFlow(steps, network) {
  const items = steps.map((s) => {
    const li = el("li", `step step-${s.stage} tone-${s.status}`);
    li.id = `step-${s.number}`;
    const dot = el("span", "step-dot");
    dot.setAttribute("aria-hidden", "true");
    const head = el("div", "step-head");
    const h = el("h3", "step-title");
    h.append(el("span", "step-number", `Step ${s.number}`), document.createTextNode(s.title));
    head.append(h);
    if (s.status !== "verified") head.append(badge(s.status));
    const tx = el("p", "step-tx");
    tx.append(document.createTextNode("tx"), idEl(s.txid, { kind: "tx", network, live: live(), key: `tx:${s.txid}`, tail: 8 }), document.createTextNode(s.height != null ? `· height ${heightText(s.height)}` : "· height unknown"));
    li.append(dot, head, tx);
    // In: what this transaction spent (or, for an origin, what funded it); out: the notes it made and what it paid.
    const io = el("div", "io");
    const inCol = el("div", "io-col io-in");
    const ins = el("ul", "chips");
    ins.append(...sourceChips(s, network), ...s.spent.map((n) => noteChip({ ...n, from: steps.find((t) => t.created.some((x) => x.id === n.id))?.number ?? null }, network, { side: "in" })));
    inCol.append(el("h4", "", s.stage === "origin" ? "Funded by" : "Spent"), ins);
    const arrow = el("span", "i i-arrow io-arrow");
    arrow.setAttribute("aria-hidden", "true");
    const outCol = el("div", "io-col io-out");
    const outs = el("ul", "chips");
    outs.append(...s.created.map((n) => noteChip(n, network, { side: "out" })), ...s.payments.map((p) => paymentChip(p, network)));
    outCol.append(el("h4", "", s.stage === "control" ? "Reply" : s.stage === "origin" ? "Received" : "Created and paid"), outs);
    io.append(inCol, arrow, outCol);
    li.append(io);
    // An origin whose transaction names no source, and what this transaction paid that the disclosed notes do not
    // explain (spec §5.6).
    for (const u of s.unexplained ?? []) li.append(el("p", "step-flag", u.text));
    if (s.undisclosed_zat > 0) li.append(el("p", "step-flag", `Not fully explained: this transaction also spent at least ${amountText(s.undisclosed_zat, network)} from notes the dossier does not disclose.`));
    const edges = el("ul", "edges");
    edges.setAttribute("aria-label", `Claims in step ${s.number}`);
    for (const e of s.edges) {
      const row = el("li", `edge tone-${e.status}`);
      row.append(el("span", "edge-kind", `${claimNumbers(e.indices)} ${KIND_LABEL[e.kind]}`), el("span", "edge-label", e.label), badge(e.status, { compact: true }));
      if (e.untraced?.length) row.append(el("span", "edge-flag", `${e.untraced.join(", ")} not traced to an origin`));
      if (e.unexplained) row.append(el("span", "edge-flag", `names no source: ${e.unexplained}`));
      edges.append(row);
    }
    li.append(edges);
    return li;
  });
  $("flow").replaceChildren(...items);
}

/** Sources of funds: each origin's funders (Blockscout's detail grid), from the report's funding. */
function renderFunders(dossier, report) {
  const network = report.network;
  const origins = (report.claims ?? []).filter((c) => c.kind === "origin");
  const blocks = origins.map((c) => {
    const noteId = dossier?.claims?.[c.index]?.note;
    const n = report.notes?.[noteId];
    const div = el("div", "funder");
    const head = el("div", "funder-head");
    head.append(el("h3", "", `Origin of ${noteId ?? "a note"}`));
    if (n?.txid) head.append(idEl(n.txid, { kind: "tx", network, live: live(), key: `tx:${n.txid}` }));
    if (n?.height != null) head.append(el("span", "muted", `height ${heightText(n.height)}`));
    head.append(badge(c.status));
    div.append(head);
    const f = c.funding;
    if (!f) { div.append(el("p", "muted", "Not established: the claim did not verify.")); return div; }
    const t = f.transparent_inputs ?? [];
    if (t.length) {
      div.append(el("p", "muted", `${t.length} transparent input${t.length === 1 ? "" : "s"} funded this transaction. Each address and value is read from the output the input spends; who holds an address is not proven here, unless the holder paid it in this dossier.`));
      const wrap = el("div", "table-wrap");
      const table = el("table", "data-table funders-table");
      const thead = el("thead");
      const hr = el("tr");
      for (const [h, cls] of [["Input", ""], ["Address", ""], ["Amount", "r"], ["Spends", ""]]) { const th = el("th", cls, h); th.scope = "col"; hr.append(th); }
      thead.append(hr);
      const tbody = el("tbody");
      tbody.append(...t.map((i, k) => {
        const tr = el("tr");
        tr.dataset.key = `Input ${k + 1}`;
        const addr = el("td");
        addr.append(i.address ? idEl(i.address, { kind: "address", network, live: live(), key: `addr:${i.address}`, label: `address of input ${k + 1}` }) : el("span", "muted", "address not known (the previous transaction was not found, or its output is not a standard one)"));
        if (i.paid_in_claim != null) addr.append(el("span", "returned", returnedText([i.paid_in_claim])));
        const amt = el("td", "r c-amt");
        amt.append(amountEl(i.value_zat ?? null, network));
        const [ptx, pout] = i.prevout.split(":");
        const prev = el("td");
        prev.append(idEl(ptx, { kind: "tx", network, live: live(), key: `tx:${ptx}`, tail: 4 }), el("span", "prevout", `output ${pout}`));
        tr.append(el("td", "muted", `Input ${k + 1}`), addr, amt, prev);
        return tr;
      }));
      table.append(thead, tbody);
      wrap.append(table);
      div.append(wrap);
      // Part of the inputs that went back to the funder: the holder received the rest (less the fee).
      for (const ch of funderChange(c.details ?? [])) {
        div.append(el("p", "funder-change", `Change: ${amountText(ch.value_zat, network)} of the inputs went back to ${ch.address} (output ${ch.output}), the funder's own address${n?.value_zat != null ? `; the holder received ${amountText(n.value_zat, network)} in ${noteId}` : ""}.`));
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
  $("limits").replaceChildren(...(report.does_not_prove ?? []).map(limitItem));
}

// ---- the challenge log (Safe's audit log): nonce issued, control mined, the answer, the deposit ----

function logRow(id, tone, value, detail) {
  const row = $(`log-${id}`);
  row.dataset.tone = tone;
  if (value !== undefined && $(`log-${id}-value`)) $(`log-${id}-value`).textContent = value;
  if (detail !== undefined && $(`log-${id}-detail`)) $(`log-${id}-detail`).replaceChildren(...(Array.isArray(detail) ? detail : [document.createTextNode(detail)]));
}

function renderLog() {
  const { nonce, height } = issued();
  const network = current?.report?.network ?? $("challenge-network").value;
  const beaconed = (current?.dossier?.claims ?? []).some((c) => c.type === "control" && beaconOf(c.nonce));
  if (nonce) {
    const b = beaconOf(nonce);
    logRow("nonce", "ok", height != null ? `H₀ ${heightText(height)}` : "no H₀", [idEl(nonce, { kind: "nonce", live: live(), tail: 6, label: "nonce" }), document.createTextNode(b ? ` · a beacon of block ${heightText(b.height)}` : generatedAt ? ` · ${utcText(generatedAt)}` : " · entered here")]);
  } else if (beaconed) logRow("nonce", "ok", "", "Not needed: the control answers a beacon, a block's hash.");
  else logRow("nonce", "idle", "", "None entered yet.");

  const r = current?.report;
  const controls = Array.isArray(r?.claims) ? r.claims.filter((c) => c.kind === "control") : [];
  if (!r || !Array.isArray(r.claims)) logRow("control", "idle", "", "Opens with a dossier.");
  else if (!controls.length) logRow("control", "warn", "", "This dossier has no control claim.");
  else {
    const c = controls[controls.length - 1];
    const reply = current.dossier?.claims?.[c.index]?.reply;
    const n = r.notes?.[reply];
    const tone = c.status === "verified" ? "ok" : c.status === "failed" ? "bad" : "warn";
    logRow("control", tone, n?.height != null ? `height ${heightText(n.height)}` : "", n?.txid ? [idEl(n.txid, { kind: "tx", network, live: live(), key: `tx:${n.txid}` }), document.createTextNode(` · claim #${c.index + 1}`)] : `Claim #${c.index + 1}`);
  }

  const nc = current?.meta?.nonce;
  const line = $("nonce-line");
  if (nc) {
    line.textContent = nc.text;
    line.dataset.state = nc.state;
    const tone = { match: "ok", beacon: "ok", mismatch: "bad", "match-unverified": "bad", "beacon-failed": "bad" }[nc.state] ?? "warn";
    $("log-answer").dataset.tone = tone;
    show("nonce-line", true);
    show("log-answer-idle", false);
  } else {
    line.textContent = "";
    delete line.dataset.state;
    $("log-answer").dataset.tone = "idle";
    show("nonce-line", false);
    show("log-answer-idle", true);
  }

  const a = assigned();
  const dep = current?.meta?.deposit;
  if (!a) logRow("deposit", "idle", "", "No address entered.");
  else if (a.error) logRow("deposit", "warn", "", "Not an address: left out of the check.");
  else if (!dep) logRow("deposit", "idle", "", "Checked when a dossier is open.");
  else if (dep.state === "paid") logRow("deposit", "ok", "", `Paid in ${dep.refs?.length ? dep.refs.join(", ") : "a verified payment"}.`);
  else logRow("deposit", "bad", "", dep.otherNetwork ? "The address is for another network than the dossier." : "No verified payment pays it.");

  const rows = ["nonce", "control", "answer", "deposit"].map((k) => $(`log-${k}`).dataset.tone);
  const active = rows.filter((t) => t !== "idle").length;
  $("challenge-state").textContent = active ? `${rows.filter((t) => t === "ok").length} of ${active} in order` : "";
}

// ---- input ----

async function loadSample(name = SAMPLE_FRAGMENT) {
  setStatus("Loading the sample dossier…", "loading");
  fileName = `Sample: ${{ [SAMPLE_FRAGMENT]: "faucet and three payments", [EXCHANGE_SAMPLE]: "exchange deposit", "sample-transparent": "transparent round trip", "sample-beacon": "beacon control" }[name] ?? name} (testnet)`;
  const mine = generation;
  const res = await fetch(SAMPLES[name], { cache: "no-store" });
  if (!res.ok) { setStatus(`The sample could not be loaded (HTTP ${res.status}).`, "error"); return; }
  const text = await res.text();
  if (mine !== generation) return;
  await check(text, name);
}

async function open(raw, source, name = null) {
  const r = readDossierInput(raw);
  if (r.sample) return loadSample(r.sample);
  fileName = name ?? (source === "link" ? "Dossier from a case link" : source === "paste" ? "Pasted dossier" : "Dossier");
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
  await open(await f.text(), "file", f.name);
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
  await open(await f.text(), "file", f.name);
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
  live().textContent = n ? `${n} transaction file${n === 1 ? "" : "s"} loaded` : "No transaction loaded";
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
// On paper the reasons and each claim's detail are open; they fold back after.
let reopened = [];
const beforePrint = () => {
  printFooter();
  reopened = [...document.querySelectorAll("details.why:not([open]), details.claim-more:not([open])")];
  for (const d of reopened) d.open = true;
};
$("print").addEventListener("click", () => { beforePrint(); window.print(); });
window.addEventListener("beforeprint", beforePrint);
window.addEventListener("afterprint", () => { for (const d of reopened) d.open = false; reopened = []; });
$("copy-summary").addEventListener("click", async () => {
  if (!current?.report) return;
  let said = "Case summary copied";
  try { await navigator.clipboard.writeText(caseSummaryText(current.dossier, current.report, { ...current.meta, caseFields: caseFields() })); }
  catch { said = "Copy failed: the browser refused the clipboard"; }
  live().textContent = said;
});

// ---- the reviewer's challenge ----

$("nonce-new").addEventListener("click", async () => {
  beaconAsked++; // a beacon still being asked for would replace this nonce
  generatedNonce = newNonce(crypto.getRandomValues(new Uint8Array(16)));
  generatedAt = new Date().toISOString();
  $("nonce-input").value = generatedNonce;
  $("h0-input").value = "";
  $("nonce-new-label").textContent = "New nonce";
  live().textContent = "New nonce generated";
  const network = $("challenge-network").value;
  const nonce = generatedNonce;
  $("h0-status").textContent = `Asking a ${NETWORK_NAME[network]} node for the chain's height…`;
  renderLog();
  try {
    countAsk("tip", GRPC_WEB_ENDPOINTS[network]?.[0]);
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

// The deposit address the reviewer assigned: the verifier checks the case on screen against it again as it is typed
// (expectDepositAddress; no new lookup, the same transactions).
let typingDeposit = null;
$("deposit-input").addEventListener("input", () => {
  $("deposit-status").textContent = depositAddressStatus(assigned());
  clearTimeout(typingDeposit);
  typingDeposit = setTimeout(recheck, 250);
});

// A beacon nonce: the hash of the latest block (spec §7.4). No one could know it before that block, so a holder can
// answer it unprompted, and any verifier dates the answer by looking the block up; the reviewer judges whether the
// block is recent enough. Asks a node for the tip and that block (heights only).
let beaconAsked = 0;
$("beacon-new").addEventListener("click", async () => {
  const mine = ++beaconAsked;
  const network = $("challenge-network").value;
  $("h0-status").textContent = `Asking a ${NETWORK_NAME[network]} node for the latest block…`;
  try {
    countAsk("tip", GRPC_WEB_ENDPOINTS[network]?.[0]);
    const tip = await fetchChainTip(network, GRPC_WEB_ENDPOINTS[network], { timeoutMs: PAGE_TIMEOUT_MS });
    countAsk("block", GRPC_WEB_ENDPOINTS[network]?.[0]);
    const block = await fetchBlockId(network, tip.height, GRPC_WEB_ENDPOINTS[network], { timeoutMs: PAGE_TIMEOUT_MS });
    if (mine !== beaconAsked) return;
    generatedNonce = beaconNonce(block.height, block.hash);
    generatedAt = new Date().toISOString();
    $("nonce-input").value = generatedNonce;
    // No answer can be in block H itself (its hash would have to be known before it was mined): H₀ is H + 1.
    $("h0-input").value = String(block.height + 1);
    $("h0-status").textContent = `A beacon: the hash of block ${block.height} on ${NETWORK_NAME[network]}, mined ${blockTimeText(block.time)}. No one could know it before that block, so a holder can answer it without being asked, and anyone can check when. H₀ is ${block.height + 1}: a control transaction mined before it fails.`;
    live().textContent = "Beacon nonce generated";
    recheck();
  } catch (e) {
    if (mine !== beaconAsked) return;
    $("h0-status").textContent = `The latest block could not be asked (${String(e?.message ?? e)}): try again, or generate a nonce instead.`;
  }
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
  $("h0-status").textContent = `The sample's challenge: issued at height ${heightText(c.height)} on ${NETWORK_NAME[c.network]}.`;
  if (current?.meta?.txs && current.meta.source === name) recheck();
  else { dropFragment(); await loadSample(name); }
}
const shownSample = () => (Object.hasOwn(SAMPLE_CHALLENGE, current?.meta?.source ?? "") ? current.meta.source : SAMPLE_FRAGMENT);
$("sample-nonce").addEventListener("click", () => sampleChallenge(shownSample()));
$("sample-challenge").addEventListener("click", () => sampleChallenge(EXCHANGE_SAMPLE));
$("sample-exchange").addEventListener("click", () => { dropFragment(); loadSample(EXCHANGE_SAMPLE); });

linkSelection(document.getElementById("main"));

// The rail sticks below the top bar when it fits on the screen, and otherwise once its foot reaches the screen's foot,
// so all of it can be read (CSSOM, which the style-src policy allows).
const rail = document.querySelector(".case-rail");
const fitRail = () => {
  const top = Math.min(72, window.innerHeight - rail.offsetHeight - 16);
  rail.style.setProperty("--rail-top", `${Math.round(top)}px`);
};
new ResizeObserver(fitRail).observe(rail);
window.addEventListener("resize", fitRail);
renderLog();

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
