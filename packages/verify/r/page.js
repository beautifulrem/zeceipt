// Public receipt page: reads the receipt from location.hash (spec §2.1) and verifies it here.
// The DOM is written with textContent only, so nothing from a receipt is ever parsed as HTML.
// Nothing is stored; the only request outside this site is the transaction lookup the user
// asks for (fetchRawTx), which carries the txid and nothing else.
import { initVerifier, parseReceipt, verifyReceipt, fetchRawTx, GRPC_WEB_ENDPOINTS } from "../src/index.js";
import { STAGE_COPY, NOT_FOUND_COPY, summaryRows, fetchPlan, outcome } from "./view.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const rows = (table, pairs) => {
  table.replaceChildren(...pairs.map(([k, v]) => {
    const tr = document.createElement("tr");
    for (const text of [k, v]) { const td = document.createElement("td"); td.textContent = text; tr.append(td); }
    return tr;
  }));
};

let generation = 0; // bumps on every new link, so a late result for an old link is dropped
let current = null; // { link, receipt, raw, source }

function clearOutcome() {
  show("outcome", false);
  $("outcome").className = "";
  $("source-status").textContent = "";
}

function render() {
  generation++;
  clearOutcome();
  for (const id of ["empty", "unreadable", "receipt"]) show(id, false);
  const link = location.hash;
  if (link.length <= 1) { current = null; show("empty", true); return; }
  let receipt;
  try {
    receipt = parseReceipt(link);
  } catch (e) {
    current = null;
    $("unreadable-copy").textContent = STAGE_COPY.parse;
    $("unreadable-error").textContent = String(e);
    show("unreadable", true);
    return;
  }
  current = { link, receipt, raw: null, source: null };
  rows($("summary"), summaryRows(receipt));
  const plan = fetchPlan(receipt.network, GRPC_WEB_ENDPOINTS[receipt.network]);
  $("fetch").hidden = !plan.canFetch;
  $("fetch").disabled = false;
  $("fetch-note").textContent = plan.note;
  $("rawfile").value = "";
  $("challenge").value = "";
  show("challenge-row", Boolean(receipt.challenge));
  show("receipt", true);
}

function verifyNow() {
  if (!current || current.raw === null) return;
  const result = verifyReceipt(current.link, current.raw, { challenge: $("challenge").value, requireSignature: false });
  const view = outcome(result, current.source);
  $("headline").textContent = view.headline;
  show("invalid", !view.valid);
  show("parts", view.valid);
  if (view.valid) {
    rows($("payment"), view.payment);
    $("inclusion").textContent = view.inclusion.text;
    $("issuer").replaceChildren(...view.issuer.map((line) => { const li = document.createElement("li"); li.textContent = line; return li; }));
    $("challenge-line").textContent = view.challenge;
    $("outcome").className = view.inclusion.state === "mined" || view.inclusion.state === "unknown" ? "ok" : "pending";
  } else {
    $("stage-copy").textContent = view.stageCopy;
    $("stage-error").textContent = view.error;
    $("outcome").className = "bad";
  }
  show("outcome", true);
}

// A challenge-bound receipt waits for the challenge; any other verifies as soon as the transaction is in.
function transactionLoaded(raw, source, statusText) {
  current.raw = raw;
  current.source = source;
  $("source-status").textContent = statusText;
  if (current.receipt.challenge && $("challenge").value === "") {
    $("source-status").textContent = `${statusText} Enter the challenge you sent, then Verify.`;
    return;
  }
  verifyNow();
}

$("fetch").addEventListener("click", async () => {
  if (!current) return;
  const mine = generation;
  const { receipt } = current;
  $("fetch").disabled = true;
  $("source-status").textContent = "Fetching the transaction…";
  try {
    const got = await fetchRawTx(receipt.txid, receipt.network);
    if (mine !== generation) return;
    transactionLoaded(got.hex, { kind: "node", chain: got.chain, endpoint: got.endpoint }, "Transaction fetched.");
  } catch (e) {
    if (mine !== generation) return;
    const msg = String(e);
    $("source-status").textContent = /not found/i.test(msg) ? `${NOT_FOUND_COPY} (${msg})` : `The fetch failed: ${msg}. You can load the raw transaction from a file instead.`;
  } finally {
    if (mine === generation) $("fetch").disabled = false;
  }
});

$("rawfile").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f || !current) return;
  const mine = generation;
  const text = (await f.text()).trim();
  if (mine !== generation) return;
  transactionLoaded(text, { kind: "file" }, `Transaction loaded from ${f.name}.`);
});

$("verify").addEventListener("click", verifyNow);
window.addEventListener("hashchange", render);

initVerifier().then(
  (v) => { $("status").textContent = `${v}: verification runs in this page.`; render(); },
  (e) => { $("status").textContent = `The verifier failed to load: ${e}`; },
);
