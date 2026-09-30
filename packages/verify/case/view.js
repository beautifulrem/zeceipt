// Pure display logic for the case review page (case/index.html) and the dossier builder (build/index.html): a dossier
// (zeceipt-dossier-v1, spec/dossier-v1.md) and its report (zeceipt-dossier-report-v1) in, plain strings and plain data
// out. No DOM here; case/page.js and build/page.js render these with textContent only. Tested by test/dossier-view.mjs.
import { valueParts, nodeHost } from "../r/view.js";

export const NETWORK_NAME = { main: "Zcash mainnet", test: "Zcash testnet", regtest: "local regtest chain (development only)" };
export const KIND_LABEL = { origin: "Origin", path: "Path", deposit: "Deposit", control: "Control" };
export const STATUS_LABEL = { verified: "Verified", failed: "Failed", not_checked: "Not checked yet", unproven: "Not proven" };
/** The four claim types, one line each (the landing page says the same). */
export const KIND_BLURB = {
  origin: "Where the funds entered the holder's wallet, and what funded that transaction.",
  path: "A disclosed note was spent in the transaction that created the next one.",
  deposit: "A payment the holder made, opened by a sender receipt, paid from disclosed notes.",
  control: "A challenge transaction spent disclosed notes and paid the holder a note whose memo carries your nonce.",
};
/** The fragment that opens the committed testnet sample (case/#sample): the README links it. */
export const SAMPLE_FRAGMENT = "sample";
export const SAMPLE_PATH = "fixtures/testnet-dossier.json";
export const NONCE_PREFIX = "zeceipt-challenge-";

/** The coin's name on a network: TAZ off mainnet (a testnet amount named ZEC misnames a coin with no value). */
export const unitFor = (network) => (network === "main" ? "ZEC" : "TAZ");

/** Zatoshi to the eight-decimal string ("24743750" → "0.24743750"). */
export function formatZat(zat) {
  const z = BigInt(zat);
  return `${z / 100_000_000n}.${String(z % 100_000_000n).padStart(8, "0")}`;
}

/** An amount as a person reads it: "0.2474375 TAZ" (the digits up to the last significant one). */
export function amountText(zat, network) {
  if (zat === undefined || zat === null) return "value unknown";
  return `${valueParts(formatZat(zat)).major} ${unitFor(network)}`;
}

/** The core's short txid ("90f6a335…2a4b"), so the timeline and the summaries name transactions alike. */
export const shortTxid = (txid) => (typeof txid === "string" && txid.length > 13 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid ?? "");
export const middle = (text, head = 10, tail = 6) => (typeof text === "string" && text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text ?? "");

// ---- the fragment and the input ----

export function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s) {
  const clean = String(s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) throw new Error("not base64url");
  const b64 = clean.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * What a person gave the page: dossier JSON, a case link (…/case/#<base64url>), a bare base64url payload, or the
 * sample fragment. Returns `{ sample: true }`, `{ text }` (the dossier JSON as given) or `{ error }`.
 */
export function readDossierInput(raw) {
  // JSON is kept exactly as given, so the report's dossier_sha256 is the sha256 of the holder's file.
  const given = String(raw ?? "");
  let s = given.trim();
  if (!s) return { error: "Nothing to check: paste a dossier, drop its file, or open a case link." };
  if (s.startsWith("{")) return { text: given };
  const hash = s.lastIndexOf("#");
  if (hash >= 0) s = s.slice(hash + 1).trim();
  if (s === SAMPLE_FRAGMENT) return { sample: true };
  try {
    const text = fromBase64Url(s);
    if (text.trim().startsWith("{")) return { text };
  } catch { /* reported below */ }
  return { error: "This is not a dossier: expected its JSON, or a case link whose part after “#” carries one." };
}

/** The dossier's own JSON, or null when it does not parse (the verifier reports why). */
export function parseDossier(text) {
  try {
    const d = JSON.parse(text);
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

/** The case link for a dossier: `base` is the case page's URL (…/case/). */
export const caseLink = (base, text) => `${String(base).replace(/#.*$/, "")}#${toBase64Url(text)}`;

// ---- checking ----

/**
 * The progress line while the transactions are fetched: "Fetching 3 of 5 from zjs.zec.rocks/testnet…"; round 1 is the
 * verifier's second round, the transactions whose outputs funded an origin.
 */
export function fetchProgress(index, total, endpoint, round = 0) {
  return round === 0
    ? `Fetching ${index + 1} of ${total} from ${nodeHost(endpoint)}…`
    : `Fetching the funders' transactions, ${index + 1} of ${total}, from ${nodeHost(endpoint)}…`;
}

/** Counts of claims by status. */
export function statusCounts(claims = []) {
  const c = { verified: 0, failed: 0, not_checked: 0, unproven: 0 };
  for (const x of claims) c[x.status] = (c[x.status] ?? 0) + 1;
  return c;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listJoin = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "1 origin, 7 path hops, 3 deposits and 1 control answer". */
export function kindBreakdown(claims = []) {
  const n = (k) => claims.filter((c) => (c.kind ?? c.type) === k).length;
  const parts = [];
  if (n("origin")) parts.push(plural(n("origin"), "origin"));
  if (n("path")) parts.push(plural(n("path"), "path hop"));
  if (n("deposit")) parts.push(plural(n("deposit"), "deposit"));
  if (n("control")) parts.push(plural(n("control"), "control answer"));
  return listJoin(parts);
}

/**
 * The case banner: `tone` is ok, pending or bad (the verdict component's classes); the words carry the meaning, the
 * colour only follows them.
 */
export function caseVerdict(report) {
  if (!report || report.error || !Array.isArray(report.claims)) {
    return { tone: "bad", headline: "Not a readable dossier", sub: report?.error ? `The verifier could not read it: ${report.error}` : "The verifier could not read it.", counts: null };
  }
  const counts = statusCounts(report.claims);
  const n = report.claims.length;
  if (counts.failed > 0) {
    return {
      tone: "bad",
      headline: `${plural(counts.failed, "claim")} failed`,
      sub: `${counts.verified} of ${n} verified${counts.not_checked ? `, ${counts.not_checked} not checked` : ""}. A failed claim is not supported by the chain: its row below says why.`,
      counts,
    };
  }
  if (counts.not_checked > 0) {
    return {
      tone: "pending",
      headline: "Not all checked",
      sub: `${counts.verified} of ${n} verified; ${plural(counts.not_checked, "claim")} could not be checked yet (a transaction was not found, or is not mined). Check again later.`,
      counts,
    };
  }
  if (counts.unproven > 0) {
    return {
      tone: "pending",
      headline: `${plural(counts.unproven, "claim")} not proven`,
      sub: `${counts.verified} of ${n} verified; ${plural(counts.unproven, "claim")} cannot be shown with this dossier (its row says what would show it). Waiting will not change that.`,
      counts,
    };
  }
  if (!report.all_verified) {
    return {
      tone: "pending",
      headline: "Not all verified",
      sub: (report.problems ?? []).join(" ") || `${counts.verified} of ${n} verified.`,
      counts,
    };
  }
  return {
    tone: "ok",
    headline: n === 1 ? "1 claim verified" : `All ${n} claims verified`,
    sub: `Every claim holds against the chain: ${kindBreakdown(report.claims)}.`,
    counts,
  };
}

/** The rows of the claims table, in the dossier's order. */
export function claimRows(report) {
  return (report?.claims ?? []).map((c) => ({
    index: c.index,
    number: c.index + 1,
    kind: c.kind,
    kindLabel: KIND_LABEL[c.kind] ?? c.kind,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status] ?? c.status,
    summary: c.summary,
    details: c.details ?? [],
  }));
}

const RANK = { verified: 0, not_checked: 1, unproven: 2, failed: 3 };
const worst = (statuses) => statuses.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), "verified");

/** One line on where an origin's funds came from, from the report's `funding`. */
export function fundingText(funding, network) {
  if (!funding) return "Not established: the claim did not verify.";
  if (funding.from_disclosed?.length) return `From disclosed ${funding.from_disclosed.length === 1 ? "note" : "notes"} ${funding.from_disclosed.join(", ")}.`;
  const t = funding.transparent_inputs ?? [];
  if (t.length) {
    const addrs = [...new Set(t.map((i) => i.address).filter(Boolean))];
    const valued = t.every((i) => i.value_zat != null);
    const total = valued ? ` (${amountText(t.reduce((a, i) => a + i.value_zat, 0), network)})` : "";
    return `From ${plural(t.length, "transparent input")}${total}${addrs.length ? `, paid from ${addrs.join(", ")}` : ""}.`;
  }
  return `From shielded funds of an undisclosed sender (the transaction has ${plural(funding.shielded_actions ?? 0, "shielded action")}${funding.sapling_spends ? ` and ${plural(funding.sapling_spends, "Sapling spend")}` : ""}).`;
}

/**
 * The funds flow, one step per transaction, oldest first: where funds entered (origin), each transaction that moved
 * or paid them (path hops and deposits), and the control answer. Each step names its transaction and height, the
 * disclosed notes it spent and created, the payments it made, and one edge per claim with that claim's status.
 * `extras.heights` (txid → height) and `extras.payments` (receipt id → { recipient, value_zat, memo }) add what the
 * report does not carry: a deposit transaction's height and a receipt's payment.
 */
export function flowSteps(dossier, report, extras = {}) {
  const notes = report?.notes ?? {};
  const network = report?.network ?? dossier?.network;
  const claims = dossier?.claims ?? [];
  const results = report?.claims ?? [];
  const receipts = dossier?.receipts ?? {};
  const heights = extras.heights ?? {};
  const payments = extras.payments ?? {};
  const steps = new Map();
  const note = (id) => ({ id, value_zat: notes[id]?.value_zat, value: amountText(notes[id]?.value_zat, network), txid: notes[id]?.txid, height: notes[id]?.height ?? null, memo: notes[id]?.memo, error: notes[id]?.error });
  const step = (txid) => {
    const key = (txid ?? "").toLowerCase();
    if (!steps.has(key)) steps.set(key, { txid: key, height: heights[key] ?? null, stages: new Set(), spent: [], created: [], payments: [], edges: [], funding: [], claims: [] });
    return steps.get(key);
  };
  const addUnique = (list, item) => { if (!list.some((x) => x.id === item.id)) list.push(item); };
  claims.forEach((c, i) => {
    const r = results[i] ?? { status: "not_checked", summary: "" };
    const status = r.status;
    let s;
    if (c.type === "origin") {
      s = step(notes[c.note]?.txid);
      s.stages.add("origin");
      addUnique(s.created, note(c.note));
      s.funding.push({ note: c.note, text: fundingText(r.funding, network), funding: r.funding ?? null });
      s.edges.push({ index: i, kind: "origin", status, label: `Funds reach the holder as ${c.note}` });
    } else if (c.type === "path") {
      s = step(notes[c.to]?.txid);
      s.stages.add("path");
      addUnique(s.spent, note(c.from));
      addUnique(s.created, note(c.to));
      s.edges.push({ index: i, kind: "path", status, label: `${c.from} → ${c.to}` });
    } else if (c.type === "deposit") {
      const rc = receipts[c.receipt] ?? {};
      s = step(rc.txid);
      s.stages.add("deposit");
      for (const f of c.funded_by ?? []) addUnique(s.spent, note(f));
      const p = payments[c.receipt] ?? {};
      const value = p.value_zat ?? r.value_zat;
      s.payments.push({ id: c.receipt, value_zat: value ?? null, value: amountText(value, network), recipient: p.recipient ?? null, memo: p.memo ?? null });
      s.edges.push({ index: i, kind: "deposit", status, label: `${(c.funded_by ?? []).join(", ") || "undisclosed notes"} → payment ${c.receipt}` });
    } else if (c.type === "control") {
      s = step(notes[c.reply]?.txid);
      s.stages.add("control");
      for (const f of c.spent ?? []) addUnique(s.spent, note(f));
      addUnique(s.created, { ...note(c.reply), reply: true });
      s.nonce = c.nonce;
      s.edges.push({ index: i, kind: "control", status, label: `${(c.spent ?? []).join(", ")} → ${c.reply}, whose memo carries the nonce` });
    } else {
      return;
    }
    s.claims.push(i);
  });
  const list = [...steps.values()];
  for (const s of list) {
    if (s.height === null) s.height = s.created.map((n) => n.height).find((h) => h != null) ?? null;
    s.status = worst(s.edges.map((e) => e.status));
    s.stage = s.stages.has("control") ? "control" : s.stages.has("origin") ? "origin" : "hop";
    s.title = stepTitle(s);
    delete s.stages;
  }
  list.sort((a, b) => (a.height ?? Infinity) - (b.height ?? Infinity) || Math.min(...a.claims) - Math.min(...b.claims));
  // Where each created note goes next, so a reader can follow the funds down the list.
  list.forEach((s, i) => {
    s.number = i + 1;
    for (const n of s.created) {
      const next = list.findIndex((t) => t !== s && t.spent.some((x) => x.id === n.id));
      n.next = next >= 0 ? next + 1 : null;
    }
  });
  return list;
}

function stepTitle(s) {
  if (s.stage === "control") return "Control: the holder answered the challenge";
  if (s.stage === "origin") return "Origin: funds enter the holder's wallet";
  if (s.payments.length && s.created.length) return "Moved within the wallet, and paid out";
  if (s.payments.length) return "Paid out";
  return "Moved within the wallet";
}

/** One line for a note chip: "n2 · 0.2474375 TAZ". */
export const noteLabel = (n) => `${n.id} · ${n.error ? "does not open" : n.value}`;

/**
 * Whether the dossier's control claim answers the nonce this page generated. The nonce lives in the page's memory
 * only; `generated` is null when none was made here.
 */
export function nonceCheck(dossier, report, generated) {
  const controls = (dossier?.claims ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.type === "control");
  if (!controls.length) {
    return { state: "no-control", text: "This dossier has no control claim: it does not show that the holder can spend these funds now. Send the holder a challenge." };
  }
  const nonces = controls.map(({ c }) => String(c.nonce).trim());
  if (!generated) {
    return { state: "not-generated", text: `The control claim answers nonce ${nonces.join(", ")}. No nonce was generated in this page: compare it with the one you sent the holder.` };
  }
  const hit = controls.find(({ c }) => String(c.nonce).trim() === generated);
  if (hit) {
    const ok = report?.claims?.[hit.i]?.status === "verified";
    return ok
      ? { state: "match", text: `The control claim answers the nonce you generated in this page (${generated}), and it verified.` }
      : { state: "match-unverified", text: `The control claim names the nonce you generated in this page (${generated}), but that claim did not verify.` };
  }
  return { state: "mismatch", text: `The control claim answers ${nonces.join(", ")}, not the nonce you generated in this page (${generated}). It may answer an earlier challenge, or someone else's: ask the holder to answer yours.` };
}

/** A fresh reviewer nonce from 16 random bytes (the page passes crypto.getRandomValues' output). */
export function newNonce(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new Error("16 random bytes");
  return NONCE_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "2026-09-30 12:40 UTC". */
export const utcText = (iso) => `${String(iso).slice(0, 16).replace("T", " ")} UTC`;

/** The case facts, as key–value rows; the holder's own statements are labelled as such. */
export function caseFacts(dossier, report, meta = {}) {
  const rows = [];
  rows.push(["Subject (unauthenticated)", dossier?.subject ? dossier.subject : "(none given)"]);
  rows.push(["Network", NETWORK_NAME[report?.network] ?? report?.network ?? "unknown"]);
  if (dossier?.created) rows.push(["Built (per the holder)", utcText(dossier.created)]);
  if (report?.dossier_sha256) rows.push(["Dossier sha256", report.dossier_sha256]);
  if (meta.checkedAt) rows.push(["Checked", `${utcText(meta.checkedAt)}${meta.nodes?.length ? ` against ${meta.nodes.map(nodeHost).join(" and ")}` : ", in this browser"}`]);
  return rows;
}

/** The plain-text case summary a reviewer pastes into their case notes. */
export function caseSummaryText(dossier, report, meta = {}) {
  const v = caseVerdict(report);
  const lines = [`Zeceipt case review: ${v.headline}`];
  for (const [k, val] of caseFacts(dossier, report, meta)) lines.push(`${k}: ${val}`);
  if (meta.nonce) lines.push(`Control: ${meta.nonce.text}`);
  lines.push("", "Claims:");
  for (const r of claimRows(report)) lines.push(`${r.number}. ${r.kindLabel}, ${r.statusLabel.toLowerCase()}: ${r.summary}`);
  if (report?.disclosed?.length) lines.push("", "The holder disclosed:", ...report.disclosed.map((d) => `- ${d}`));
  if (report?.does_not_prove?.length) lines.push("", "This does not prove:", ...report.does_not_prove.map((d) => `- ${d}`));
  return lines.join("\n");
}

/** The report as downloaded for a case file: the verifier's report, plus when and against which nodes it was checked. */
export function reportForDownload(report, meta = {}) {
  return {
    ...report,
    case: {
      checked_at: meta.checkedAt ?? null,
      nodes: meta.nodes ?? [],
      verifier: meta.verifier ?? null,
      reviewer_nonce: meta.nonce ? { state: meta.nonce.state, generated_here: meta.generated ?? null } : null,
    },
  };
}

export const reportFileName = (report) => `zeceipt-case-${String(report?.dossier_sha256 ?? "report").slice(0, 12)}.json`;
