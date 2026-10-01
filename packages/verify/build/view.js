// Pure logic for the dossier builder (build/index.html): the holder's inputs checked before anything is fetched, the
// builder's errors in words a holder can act on, and the summary of what a dossier discloses. No DOM here; build/page.js
// renders these with textContent only. Tested by test/dossier-view.mjs.
import { NETWORK_NAME, NONCE_PREFIX, kindBreakdown } from "../case/view.js";

const TXID = /^[0-9a-f]{64}$/;
const UFVK_NETWORK = [[/^uviewtest1/, "test"], [/^uviewregtest1/, "regtest"], [/^uview1/, "main"]];

/** The network a UFVK's prefix names, or null (the verifier decodes it properly; this only phrases a mismatch early). */
export function ufvkNetwork(ufvk) {
  const s = String(ufvk ?? "").trim();
  return UFVK_NETWORK.find(([re]) => re.test(s))?.[1] ?? null;
}

/**
 * The network to select for a UFVK as it is typed, from its prefix (uview1 → main, uviewtest1 → test, uviewregtest1 →
 * regtest): `{ network, note }`. `network` is null when the prefix names none, or names one the page does not offer
 * (`offered`, the select's values); `note` then says why, for a key that is recognised.
 */
export function networkForKey(ufvk, offered = ["main", "test"]) {
  const net = ufvkNetwork(ufvk);
  if (!net) return { network: null, note: null };
  if (offered.includes(net)) return { network: net, note: null };
  return { network: null, note: `This is a key for the ${NETWORK_NAME[net]}: this page reads only mainnet and testnet from public nodes. Build a regtest dossier with the command line (zeceipt dossier build).` };
}

/**
 * The sample customer of the exchange-deposit review (docs/PROOF.md §9): a public testnet viewing key, published as
 * fixtures/testnet/holder2-ufvk.txt (test/dossier-view.mjs checks they agree), and the height to scan from. Its
 * transactions were mined before NU7 reached testnet, so the builder keeps working on them after 2026-10-06.
 */
export const SAMPLE_UFVK = "uviewtest14me90fl05mxtzmt0qydd5l3g3x5lakypxkm6uz6rhxvquzl4620ac7xd32dyls945y3l2kts0cefeep8esng05tfhn9e2287duz7ap9qmz8gvlaftakcrtpeefr9nad85t7yk9gehl2p4sneah88trjfw43455px0ry27ddkw27cmsaf45zzlfcn2ucm5f442kww5qvx0g96ca43yehv80ch52vwjsh5tl589cyxmyffq0jmyyrp4zuwu6c6uxus6fwepp5lwjzguec870ujgefm6a75uvw79xvxe5gg2s7g9s36qxkdce5a58dclsysat6y50q0hm0cafdmke6qar424xmquyzxusyakyyu7s3fqy4p4y4m887wgdcl06gxr6uqrkvrwexhuz7mrqpt2yewjec7kyfuy3tezsnyh6rkjg7qzlg2mljty2wlka9h80zqxr97ktzw68a6w4mvhcsu0wv90la7078dlnuxu8ga8zk6q5ln7scq";
export const SAMPLE_SCAN_FROM = 4422270;
/**
 * Where the sample's scan stops: the block of its latest challenge answer, so that a scan finds exactly the sample's
 * four transactions (the customer's later ones, if any, would be origins nothing here traces).
 */
export const SAMPLE_SCAN_TO = 4426430;
/**
 * The sample customer's latest challenge answer (docs/PROOF.md §10, fixtures/dossier/testnet-dossier-beacon.json): the
 * transaction that answers a beacon, the hash of block 4426425. A scan cannot read memos, so the page knows this one
 * by its id, and puts it under Control with its nonce.
 */
export const SAMPLE_CONTROL = { txid: "701df8b1c1ac49037290fc6e363f3d2c8315ecdeb6c50891fbee4ad9a83970ce", nonce: "zeceipt-beacon-4426425-00000f9702b40e9cd12eaf29214f14ab55f8a4edce089f83f4174b2657ce4b7f" };

/**
 * What a scan with the sample customer's key fills in: the transactions of the funds, and the latest challenge
 * answer under Control with its nonce (FE03: the sample builds green in one go). Null for any other key, or when the
 * scan did not find that answer.
 */
export function sampleScan(found, ufvk) {
  if (String(ufvk ?? "").trim() !== SAMPLE_UFVK) return null;
  const ids = (found ?? []).map((f) => f.txid);
  if (!ids.includes(SAMPLE_CONTROL.txid)) return null;
  return { txids: ids.filter((t) => t !== SAMPLE_CONTROL.txid), control: { ...SAMPLE_CONTROL } };
}

/** Transaction ids, one per line (blank lines, surrounding spaces and a trailing comma ignored). */
export const txidLines = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim().replace(/,$/, "").trim()).filter(Boolean);

/**
 * Check the form before anything is fetched. Returns `{ ok: true, input }` (`input`: network, ufvk, txids, control,
 * subject, for buildDossier) or `{ ok: false, field, error }`; `field` is the id of the input to fix. A challenge
 * transaction also in the list (as a scan puts it there) is kept only under Control: `txids` lists the rest, and `note`
 * says so.
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
  }
  const moved = n && lines.includes(c);
  const rest = moved ? lines.filter((l) => l !== c) : lines;
  if (!rest.length) return { ok: false, field: "txids", error: "List the transactions of the funds as well: the challenge transaction alone explains nothing (it goes under Control)." };
  return {
    ok: true,
    input: { network, ufvk: key, txids: rest, control: n ? { txid: c, nonce: n } : null, subject: String(subject ?? "").trim() || null },
    ...(moved ? { note: `The challenge transaction ${c.slice(0, 8)}…${c.slice(-4)} was also in the list: it was taken out, and is used only under Control.`, removed: c } : {}),
  };
}

/**
 * A listed transaction that answers a challenge, from the builder's refusal ("transaction <txid> answers a challenge
 * (a memo reads "zeceipt-challenge-…"): give it as the control transaction…"): `{ txid, memo, nonce }`, the nonce being
 * the memo's first word; null for any other error. The page offers to move it under Control, with that nonce.
 */
export function challengeAnswer(e) {
  const msg = String(e?.message ?? e);
  const m = /transaction ([0-9a-f]{64}) answers a challenge \(a memo reads "((?:[^"\\]|\\.)*)"\)/.exec(msg);
  if (!m) return null;
  const memo = m[2].replace(/\\[nrt]/g, " ").replace(/\\(.)/g, "$1");
  const nonce = memo.startsWith(NONCE_PREFIX) ? /^\S+/.exec(memo)[0] : null;
  return { txid: m[1], memo, nonce };
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
  const answer = challengeAnswer(msg);
  if (answer) {
    return `Transaction ${answer.txid.slice(0, 8)}…${answer.txid.slice(-4)} answers a reviewer's challenge (its memo reads “${answer.memo}”). A challenge answer goes under Control, with its nonce, so that the dossier discloses only its reply note and not its change.`;
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
  if (dossier?.nk) discloses.push("nk, the nullifier key: with it the reviewer computes each disclosed note's nullifier, so they can watch the chain and see when any of these notes is spent, past and future, for as long as they keep the dossier. More: the reviewer, and anyone who ever paid you and obtains this nk (an exchange that sent withdrawals to you, for example), can see when every note they paid you is spent, past and future, not only the notes in this dossier. It does not show your balance or your other payments' contents, and it cannot spend. After the case, move the remaining funds to a fresh account: its notes are not covered by this nk.");
  if (notes) discloses.push(`${notes} note opening${notes === 1 ? "" : "s"}: for each note, its transaction, amount, receiving address and memo.`);
  if (receipts) discloses.push(`${receipts} sender receipt${receipts === 1 ? "" : "s"}: each opens one payment you made (its recipient, amount and memo).`);
  if (dossier?.subject) discloses.push(`The subject you wrote: “${dossier.subject}”.`);
  const verified = (report?.claims ?? []).filter((c) => c.status === "verified").length;
  return { notes, receipts, claims: claims.length, counts, discloses, verified, allVerified: Boolean(report?.all_verified) };
}

/** The file name a dossier downloads as. */
export const DOSSIER_FILE = "dossier.json";
