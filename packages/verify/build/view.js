// Pure logic for the dossier builder (build/index.html): the holder's inputs checked before anything is fetched, the
// builder's errors in words a holder can act on, and the summary of what a dossier discloses. No DOM here; build/page.js
// renders these with textContent only. Tested by test/dossier-view.mjs.
import { NETWORK_NAME, kindBreakdown } from "../case/view.js";

const TXID = /^[0-9a-f]{64}$/;
const UFVK_NETWORK = [[/^uviewtest1/, "test"], [/^uviewregtest1/, "regtest"], [/^uview1/, "main"]];

/** The network a UFVK's prefix names, or null (the verifier decodes it properly; this only phrases a mismatch early). */
export function ufvkNetwork(ufvk) {
  const s = String(ufvk ?? "").trim();
  return UFVK_NETWORK.find(([re]) => re.test(s))?.[1] ?? null;
}

/** Transaction ids, one per line (blank lines, surrounding spaces and a trailing comma ignored). */
export const txidLines = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim().replace(/,$/, "").trim()).filter(Boolean);

/**
 * Check the form before anything is fetched. Returns `{ ok: true, input }` (`input`: network, ufvk, txids, control,
 * subject, for buildDossier) or `{ ok: false, field, error }`; `field` is the id of the input to fix.
 */
export function validateBuild({ network, ufvk, txids, nonce, controlTxid, subject }) {
  const key = String(ufvk ?? "").trim();
  if (!key) return { ok: false, field: "ufvk", error: "Paste your wallet's unified full viewing key." };
  if (/\s/.test(key)) return { ok: false, field: "ufvk", error: "The viewing key has a space or a line break in it: paste it as one line." };
  const keyNet = ufvkNetwork(key);
  if (!keyNet) return { ok: false, field: "ufvk", error: "This is not a unified full viewing key: one starts with uview1 on mainnet, uviewtest1 on testnet." };
  if (keyNet !== network) return { ok: false, field: "network", error: `This viewing key is for ${NETWORK_NAME[keyNet]}, and the network chosen is ${NETWORK_NAME[network] ?? network}. Choose ${NETWORK_NAME[keyNet]}, or use the key of the wallet on ${NETWORK_NAME[network] ?? network}.` };
  const lines = txidLines(txids).map((l) => l.toLowerCase());
  if (!lines.length) return { ok: false, field: "txids", error: "List at least one transaction id: the one that brought the funds in, then each that moved or paid them." };
  const bad = lines.findIndex((l) => !TXID.test(l));
  if (bad >= 0) return { ok: false, field: "txids", error: `Line ${bad + 1} is not a transaction id (64 hexadecimal characters): “${lines[bad].slice(0, 80)}”.` };
  const dup = lines.findIndex((l, i) => lines.indexOf(l) !== i);
  if (dup >= 0) return { ok: false, field: "txids", error: `Line ${dup + 1} repeats transaction ${lines[dup].slice(0, 8)}…: list each once.` };
  const n = String(nonce ?? "").trim();
  const c = String(controlTxid ?? "").trim().toLowerCase();
  if (n || c) {
    if (!n) return { ok: false, field: "nonce", error: "Enter the reviewer's nonce that the challenge transaction's memo carries, or leave both control fields empty." };
    if (n.length < 8) return { ok: false, field: "nonce", error: "A reviewer's nonce has at least 8 characters: paste it exactly as they sent it." };
    if (!c) return { ok: false, field: "control-txid", error: "Enter the id of the challenge transaction (the one whose memo carries the nonce), or leave both control fields empty." };
    if (!TXID.test(c)) return { ok: false, field: "control-txid", error: "The challenge transaction id is not a transaction id (64 hexadecimal characters)." };
    if (lines.includes(c)) return { ok: false, field: "txids", error: "The challenge transaction is also in the list of transactions: list it only under Control." };
  }
  return {
    ok: true,
    input: { network, ufvk: key, txids: lines, control: n ? { txid: c, nonce: n } : null, subject: String(subject ?? "").trim() || null },
  };
}

/** The builder's and the fetch's failures, in words a holder can act on. `network` is the one chosen. */
export function buildError(e, network) {
  const msg = String(e?.message ?? e).replace(/^Error: /, "");
  if (e?.code === "not_found" || /not found/i.test(msg)) {
    const txid = /transaction ([0-9a-f]{64})/.exec(msg)?.[1];
    return `${txid ? `Transaction ${txid.slice(0, 8)}…${txid.slice(-4)}` : "A transaction"} was not found on ${NETWORK_NAME[network] ?? network}: check the id, and that the network is the wallet's.`;
  }
  let m = /UFVK is for network (\w+) but we expected (\w+)/.exec(msg);
  if (m) {
    const name = (n) => ({ Main: NETWORK_NAME.main, Test: NETWORK_NAME.test, Regtest: NETWORK_NAME.regtest })[n] ?? n;
    return `This viewing key is for ${name(m[1])}, and the network chosen is ${name(m[2])}. Choose the key's network.`;
  }
  if (/viewing key could not be decoded/.test(msg)) return `This viewing key could not be read (${msg.replace(/^viewing key could not be decoded: /, "")}). Paste the whole unified full viewing key your wallet exports.`;
  if (/none of these transactions pays or spends a note this key can see/.test(msg)) {
    return "This key sees nothing in these transactions: none pays or spends a note of this wallet. Check that the key is the wallet's that holds the funds, and that the ids are that wallet's transactions.";
  }
  if (/is not hex/.test(msg)) return "A transaction the node returned is not hex: try again, or report the transaction id.";
  if (/pays the holder no note whose memo carries the nonce/.test(msg)) {
    return "The challenge transaction pays this wallet no note whose memo carries the nonce: check the nonce (exactly as the reviewer sent it), and that the challenge paid your own address with it as the memo.";
  }
  if (/spends none of the disclosed notes/.test(msg)) {
    return "The challenge transaction spends none of the notes this dossier discloses: list, above it, the transactions that created the notes it spent.";
  }
  if (/no answer within|Failed to fetch|NetworkError|HTTP \d/.test(msg)) return `The public node could not be reached (${msg}). Check your connection and try again.`;
  return `The dossier could not be built: ${msg}`;
}

/** What a built dossier holds and discloses, for the summary shown before it is shared. */
export function dossierSummary(dossier, report) {
  const notes = Object.keys(dossier?.notes ?? {}).length;
  const receipts = Object.keys(dossier?.receipts ?? {}).length;
  const claims = dossier?.claims ?? [];
  const counts = [
    ["Notes", String(notes)],
    ["Receipts", String(receipts)],
    ["Claims", `${claims.length} (${kindBreakdown(claims.map((c) => ({ kind: c.type })))})`],
  ];
  const discloses = [];
  if (dossier?.nk) discloses.push("nk, the nullifier key: the reviewer can tell when any disclosed note is spent. It does not let them see your other payments, but someone who also knows another of your notes (its sender does) could tell when that note is spent.");
  if (notes) discloses.push(`${notes} note opening${notes === 1 ? "" : "s"}: for each note, its transaction, amount, receiving address and memo.`);
  if (receipts) discloses.push(`${receipts} sender receipt${receipts === 1 ? "" : "s"}: each opens one payment you made (its recipient, amount and memo).`);
  if (dossier?.subject) discloses.push(`The subject you wrote: “${dossier.subject}”.`);
  const verified = (report?.claims ?? []).filter((c) => c.status === "verified").length;
  return { notes, receipts, claims: claims.length, counts, discloses, verified, allVerified: Boolean(report?.all_verified) };
}

/** The file name a dossier downloads as. */
export const DOSSIER_FILE = "dossier.json";
