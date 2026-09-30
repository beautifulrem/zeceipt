// Dossier builder: the holder's UFVK, the transactions of their funds and an optional control answer in; a
// zeceipt-dossier-v1 dossier out, built here by the WebAssembly builder. The UFVK is read from its field when Build is
// pressed, passed to buildDossier (which uses it in this page only), and the field is cleared; nothing is stored. The
// only requests outside this site are the transaction lookups (fetchRawTx: the txid and nothing else). The DOM is
// written with textContent only.
import { initVerifier, buildDossier, checkDossier, dossierPrevoutTxids, fetchRawTx, scanWallet, GRPC_WEB_ENDPOINTS } from "../src/index.js";
import { claimRows, caseLink, parseDossier, fetchProgress, kindBreakdown } from "../case/view.js";
import { claimTableRows, factItems, listItem, download, showVerifierDigest } from "../case/ui.js";
import { validateBuild, buildError, dossierSummary, networkForKey, DOSSIER_FILE } from "./view.js";

const PAGE_TIMEOUT_MS = 12_000;
const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
const FIELDS = ["network", "ufvk", "txids", "nonce", "control-txid", "subject", "scan-from"];

let generation = 0;
let built = null; // { text, dossier }: the last dossier built, in memory only

function setStatus(text, state) {
  $("status").textContent = text;
  $("status").dataset.state = state;
}

function clearMarks() {
  for (const id of FIELDS) {
    const f = $(`${id}-field`);
    delete f.dataset.invalid;
    $(id).removeAttribute("aria-invalid");
  }
}

function showError(text, field) {
  $("error-text").textContent = text;
  show("build-error", true);
  if (field) {
    $(`${field}-field`).dataset.invalid = "";
    $(field).setAttribute("aria-invalid", "true");
  }
  $("build-status").textContent = "";
  $("build-error").focus({ preventScroll: true });
  $("build-error").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function hideResult() {
  show("built", false);
  show("preview-card", false);
  show("build-error", false);
  $("link-status").textContent = "";
  built = null;
}

/** Fetch each transaction by id, in order, with progress; a node that cannot be reached gives way to the next. */
async function fetchHexes(ids, network, mine, round = 0) {
  const endpoints = GRPC_WEB_ENDPOINTS[network] ?? [];
  const out = [];
  let preferred = 0;
  for (const [i, txid] of ids.entries()) {
    let got = null, lastErr = null;
    for (let k = 0; k < endpoints.length && !got; k++) {
      const ep = endpoints[(preferred + k) % endpoints.length];
      if (mine !== generation) return null;
      $("build-status").textContent = fetchProgress(i, ids.length, ep, round);
      try {
        got = await fetchRawTx(txid, network, [ep], { timeoutMs: PAGE_TIMEOUT_MS });
        preferred = endpoints.indexOf(ep);
      } catch (e) {
        lastErr = e;
        if (e.code === "not_found") break; // a node's "not found" answers for its network
      }
    }
    if (!got) throw lastErr ?? new Error("no public node for this network");
    out.push({ txid, hex: got.hex, height: got.chain.status === "mined" ? got.chain.height : null, mempool: got.chain.status === "mempool" });
  }
  return out;
}

$("build").addEventListener("click", async () => {
  const mine = ++generation;
  clearMarks();
  hideResult();
  const v = validateBuild({
    network: $("network").value, ufvk: $("ufvk").value, txids: $("txids").value,
    nonce: $("nonce").value, controlTxid: $("control-txid").value, subject: $("subject").value,
  });
  if (!v.ok) { showError(v.error, v.field); return; }
  const { input } = v;
  $("build").disabled = true;
  try {
    const ids = [...input.txids, ...(input.control ? [input.control.txid] : [])];
    const fetched = await fetchHexes(ids, input.network, mine);
    if (!fetched || mine !== generation) return;
    $("build-status").textContent = "Building the dossier in this page…";
    const hexes = fetched.slice(0, input.txids.length).map((t) => t.hex);
    const controlHex = input.control ? fetched[fetched.length - 1].hex : null;
    const text = await buildDossier({ ufvk: input.ufvk, network: input.network, hexes, controlHex, control: input.control, subject: input.subject });
    if (mine !== generation) return;
    // The key has done its job: the field is cleared, and the only copy left is garbage for the collector.
    $("ufvk").value = "";
    input.ufvk = "";
    // The same check the reviewer will run, on the same transactions, so the holder sees the claims before sharing.
    const txs = Object.fromEntries(fetched.map((t) => [t.txid, { hex: t.hex, height: t.height, mempool: t.mempool }]));
    // The verifier's second round: the transactions whose outputs funded an origin (a funder's address and value).
    const prevs = dossierPrevoutTxids(text, txs).filter((t) => !(t in txs));
    if (prevs.length) {
      const more = await fetchHexes(prevs, input.network, mine, 1).catch(() => []);
      if (!more || mine !== generation) return;
      for (const t of more) txs[t.txid] = { hex: t.hex, height: t.height, mempool: t.mempool };
    }
    const report = await checkDossier(text, { txs });
    if (mine !== generation) return;
    renderBuilt(text, report);
  } catch (e) {
    if (mine !== generation) return;
    showError(buildError(e, input.network), /network/.test(String(e)) ? "network" : null);
  } finally {
    if (mine === generation) $("build").disabled = false;
  }
});

function renderBuilt(text, report) {
  const dossier = parseDossier(text);
  built = { text, dossier };
  const s = dossierSummary(dossier, report);
  $("built").className = `result ${s.allVerified ? "ok" : "pending"}`;
  $("built-sub").textContent = s.allVerified
    ? `${s.claims} claims, all verified in this page against the chain: ${kindBreakdown(report.claims)}. The viewing key field was cleared.`
    : `${s.verified} of ${s.claims} claims verified in this page; see the claims below before you share it. The viewing key field was cleared.`;
  $("built-counts").replaceChildren(...factItems(s.counts));
  $("built-discloses").replaceChildren(...s.discloses.map(listItem));
  $("preview").tBodies[0].replaceChildren(...claimTableRows(claimRows(report)));
  $("open-case").href = caseLink(new URL("../case/", location.href).href, text);
  $("build-status").textContent = "";
  show("built", true);
  show("preview-card", true);
  setStatus("Built in this page. Nothing was sent but the transaction ids.", "checked");
  $("built").focus({ preventScroll: true });
  $("built").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

$("download").addEventListener("click", () => {
  if (!built) return;
  download(built.text, DOSSIER_FILE);
  $("link-status").textContent = `Saved as ${DOSSIER_FILE}.`;
});

$("copy-link").addEventListener("click", async () => {
  if (!built) return;
  const link = caseLink(new URL("../case/", location.href).href, built.text);
  try {
    await navigator.clipboard.writeText(link);
    $("link-status").textContent = `Review link copied (${link.length.toLocaleString("en-US")} characters). It contains the dossier: send it only to your reviewer.${link.length > 8000 ? " Some chat apps cut long links; the file is safer." : ""}`;
  } catch {
    $("link-status").textContent = "The browser refused the clipboard: use the Open in Case review link, or download the file.";
  }
});

// "Find my transactions": a scan of compact blocks from a public node, trial-decrypted here with the UFVK (scanWallet).
// The UFVK is read from its field and not kept; the found txids fill the list, oldest first, without the challenge
// transaction (it is entered below).
// The network follows the key's prefix as it is typed (the holder can still change it; a mismatch is then named).
$("ufvk").addEventListener("input", () => {
  const offered = [...$("network").options].map((o) => o.value);
  const { network, note } = networkForKey($("ufvk").value, offered);
  if (network && $("network").value !== network) {
    $("network").value = network;
    delete $("network-field").dataset.invalid;
    $("network").removeAttribute("aria-invalid");
  }
  $("ufvk-network").textContent = note ?? (network ? `Network set from the key: ${$("network").selectedOptions[0].textContent}.` : "");
});
let scanAbort = null;
$("scan").addEventListener("click", async () => {
  clearMarks();
  const from = Number($("scan-from").value.trim());
  const ufvk = $("ufvk").value.trim();
  if (!ufvk) { showError("Enter your unified full viewing key first: the scan tries it on every shielded output.", "ufvk"); return; }
  if (!Number.isInteger(from) || from < 1) { showError("Enter the first height to scan, a whole number (your wallet's birthday, or a height just before the funds arrived).", "scan-from"); return; }
  hideResult();
  const network = $("network").value;
  scanAbort = new AbortController();
  $("scan").disabled = true;
  show("scan-stop", true);
  const started = Date.now();
  try {
    const found = await scanWallet({
      ufvk, network, from, signal: scanAbort.signal,
      onProgress: ({ height, to, found: n }) => {
        $("scan-status").textContent = `Reading block ${height.toLocaleString("en-US")} of ${to.toLocaleString("en-US")}; ${n} transaction${n === 1 ? "" : "s"} of yours so far…`;
      },
    });
    const control = $("control-txid").value.trim().toLowerCase();
    const ids = found.map((f) => f.txid).filter((t) => t !== control);
    $("txids").value = ids.join("\n");
    $("scan-status").textContent = found.length
      ? `Found ${found.length} transaction${found.length === 1 ? "" : "s"} of yours in ${((Date.now() - started) / 1000).toFixed(1)} s; ${ids.length} listed above${control && ids.length < found.length ? " (the challenge transaction is entered below)" : ""}.`
      : "No transaction of yours from that height: check the network and the height.";
  } catch (e) {
    $("scan-status").textContent = scanAbort.signal.aborted ? "The scan was stopped." : `The scan failed: ${e.message ?? e}`;
  } finally {
    $("scan").disabled = false;
    show("scan-stop", false);
    scanAbort = null;
  }
});
$("scan-stop").addEventListener("click", () => scanAbort?.abort());

$("forget").addEventListener("click", () => {
  generation++;
  scanAbort?.abort();
  $("scan-status").textContent = "";
  for (const id of ["ufvk", "txids", "nonce", "control-txid", "subject", "scan-from"]) $(id).value = "";
  $("network").value = "main";
  $("ufvk-network").textContent = "";
  clearMarks();
  hideResult();
  $("open-case").href = "../case/";
  $("build-status").textContent = "Everything was forgotten: the fields are empty, and no dossier is kept.";
  $("build").disabled = false;
  setStatus("Ready: the dossier is built in this page.", "ready");
  $("ufvk").focus();
});

for (const id of FIELDS) {
  $(id).addEventListener("input", () => {
    delete $(`${id}-field`).dataset.invalid;
    $(id).removeAttribute("aria-invalid");
  });
}

initVerifier().then(
  (v) => { $("version").textContent = v; setStatus("Ready: the dossier is built in this page.", "ready"); showVerifierDigest($("wasm-sha")); },
  (e) => setStatus(`The builder failed to load: ${e}`, "error"),
);
