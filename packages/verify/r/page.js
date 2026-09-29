// Public receipt page: reads the receipt from location.hash (spec §2.1) and verifies it here.
// The DOM is written with textContent only, so nothing from a receipt is ever parsed as HTML.
// Nothing is stored; a request outside this site is made only when the user asks: the transaction
// lookup (fetchRawTx, which carries the txid and nothing else) and the issuer check (checkIssuerBinding,
// a GET of the claimed domain's well-known file, spec §7, which carries nothing from the receipt).
import { initVerifier, parseReceipt, verifyReceipt, fetchRawTx, fetchChainTip, issuerClaim, checkIssuerBinding, GRPC_WEB_ENDPOINTS } from "../src/index.js";

// Each node gets 12 s here, not the package's 20 s: two hanging default nodes would otherwise keep a person waiting
// 40 s before the page says so (review A1b).
const PAGE_TIMEOUT_MS = 12_000;
import { STAGE_COPY, NOT_FOUND_COPY, summaryRows, fetchPlan, outcome, inclusion, bindingOffer, bindingText, verdictNote, valueParts } from "./view.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
// A copy button for a long identifier (slice F2): icon only, so the cell's text is still exactly the value.
const COPYABLE = { Transaction: "Copy the transaction id", Recipient: "Copy the recipient address" };
function copyButton(value, label) {
  const b = el("button", "copy");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(value); b.dataset.copied = ""; b.setAttribute("aria-label", "Copied"); }
    catch { b.setAttribute("aria-label", "Copy failed: select the text instead"); }
    setTimeout(() => { delete b.dataset.copied; b.setAttribute("aria-label", label); }, 1600);
  });
  return b;
}
const rows = (table, pairs) => {
  table.replaceChildren(...pairs.map(([k, v]) => {
    const tr = document.createElement("tr");
    tr.dataset.key = k; // lets the stylesheet give the value row its weight (slice F2); text stays textContent
    tr.append(el("td", "", k));
    const td = el("td");
    if (k === "Value") {
      // Joined, the parts are the value string itself (view.js valueParts); the zeros and the zatoshi are lighter.
      const { major, zeros, unit, zat } = valueParts(v);
      td.append(el("span", "amount", major), el("span", "amount-zeros", zeros), el("span", "amount-unit", unit), el("span", "amount-zat", zat));
    } else {
      td.append(el("span", "", v));
      if (COPYABLE[k] && navigator.clipboard) td.append(copyButton(v, COPYABLE[k]));
    }
    tr.append(td);
    return tr;
  }));
};
// Issuer lines with a 64-hex key: the key in the mono face, the words as they are (text nodes only).
const issuerLine = (line) => {
  const li = el("li");
  for (const part of line.split(/([0-9a-f]{64})/)) if (part) li.append(/^[0-9a-f]{64}$/.test(part) ? el("code", "", part) : document.createTextNode(part));
  return li;
};

let generation = 0; // bumps on every new link, so a late result for an old link is dropped
let current = null; // { link, receipt, raw, source }

function clearOutcome() {
  show("outcome", false);
  $("outcome").className = "";
  $("verdict-note").textContent = "";
  $("verdict-live").textContent = "";
  $("claims-state").textContent = "Not yet checked";
  $("fetch").className = "btn btn-primary";
  $("source-status").textContent = "";
  show("binding-row", false);
  show("binding", false);
  $("binding").textContent = "";
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
    $("issuer").replaceChildren(...view.issuer.map(issuerLine));
    $("challenge-line").textContent = view.challenge;
    // The issuer check (spec §7) is offered only for a valid, signed receipt whose key id claims a domain; it runs
    // only on a click, because the request tells that domain one of its receipts is being checked.
    const claim = issuerClaim(current.link).claim;
    show("binding", false);
    $("binding").textContent = "";
    if (claim) {
      const offer = bindingOffer(claim.domain);
      $("check-issuer").textContent = offer.button;
      $("check-issuer").disabled = false;
      $("binding-note").textContent = offer.note;
    }
    show("binding-row", Boolean(claim));
    // Green only when a node reports the transaction mined in the main chain. From a file the page
    // cannot tell (the verifier checks one output, not the whole transaction), so it is amber like
    // pending and fork; the words carry the meaning, the colour only follows them.
    $("outcome").className = view.inclusion.state === "mined" ? "ok" : "pending";
  } else {
    $("stage-copy").textContent = view.stageCopy;
    $("stage-error").textContent = view.error;
    $("outcome").className = "bad";
  }
  // The verdict comes first (review F round 1): above the claims, announced in one line, and focused, so a keyboard or
  // screen-reader user lands on it; the transaction's source is no longer the page's main action.
  const note = verdictNote(view);
  $("verdict-note").textContent = note;
  $("verdict-live").textContent = `${view.headline}. ${note || view.stageCopy}`;
  $("claims-state").textContent = view.valid ? "Checked: see the result above" : "Did not check out: see the result above";
  $("print-meta").textContent = `Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on ${location.host || "this page"}.`;
  $("fetch").className = "btn btn-secondary";
  show("outcome", true);
  $("outcome").focus({ preventScroll: true });
  $("outcome").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
    const got = await fetchRawTx(receipt.txid, receipt.network, undefined, { timeoutMs: PAGE_TIMEOUT_MS });
    if (mine !== generation) return;
    // The verdict is shown as soon as the transaction is in (slice A2b); the depth follows from the same node's tip
    // (slice A2), a request that carries nothing about the transaction. Only the inclusion line changes when it
    // arrives, so an issuer check started meanwhile is kept; a node without a usable tip leaves the depth unknown, and
    // the verdict never depends on it.
    const source = { kind: "node", chain: got.chain, endpoint: got.endpoint, tip: got.chain.status === "mined" ? undefined : null };
    transactionLoaded(got.hex, source, "Transaction fetched.");
    if (got.chain.status === "mined") {
      source.tip = await fetchChainTip(receipt.network, [got.endpoint], { timeoutMs: PAGE_TIMEOUT_MS }).then((t) => t.height, () => null);
      if (mine !== generation || current.source !== source) return;
      if (!$("parts").hidden) $("inclusion").textContent = inclusion(source).text;
    }
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

$("check-issuer").addEventListener("click", async () => {
  if (!current) return;
  const mine = generation;
  $("check-issuer").disabled = true;
  $("binding").textContent = "Checking…";
  show("binding", true);
  const b = bindingText(await checkIssuerBinding(current.link));
  if (mine !== generation) return;
  $("binding").textContent = b.text;
  // Green only when the domain vouches; amber otherwise, never red: the payment is proven either way.
  $("binding").className = b.state === "confirmed" ? "ok" : "pending";
  $("check-issuer").disabled = false;
});

$("verify").addEventListener("click", verifyNow);
window.addEventListener("hashchange", render);

initVerifier().then(
  (v) => { $("status").textContent = `${v}: verification runs in this page.`; $("status").dataset.state = "ready"; render(); },
  (e) => { $("status").textContent = `The verifier failed to load: ${e}`; $("status").dataset.state = "error"; },
);
