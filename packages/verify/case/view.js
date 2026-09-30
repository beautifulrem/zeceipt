// Pure display logic for the case review page (case/index.html) and the dossier builder (build/index.html): a dossier
// (zeceipt-dossier-v1, spec/dossier-v1.md) and its report (zeceipt-dossier-report-v1) in, plain strings and plain data
// out. No DOM here; case/page.js and build/page.js render these with textContent only. Tested by test/dossier-view.mjs.
import { valueParts, nodeHost } from "../r/view.js";

export const NETWORK_NAME = { main: "Zcash mainnet", test: "Zcash testnet", regtest: "local regtest chain (development only)" };
export const KIND_LABEL = { origin: "Origin", path: "Path", deposit: "Deposit", control: "Control", transparent_payment: "Transparent payment" };
export const STATUS_LABEL = { verified: "Verified", failed: "Failed", not_checked: "Not checked yet", unproven: "Not proven" };
/** What each status means, for a badge's tooltip and the glossary. */
export const STATUS_HELP = {
  verified: "Verified: the chain supports this claim.",
  failed: "Failed: the chain does not support this claim, or its data does not check. Its row says why.",
  not_checked: "Not checked yet: a transaction it rests on was not found, or is not mined yet. Check again later.",
  unproven: "Not proven: nothing in this dossier can show it, and waiting will not change that. Its row says what would.",
};
/** The four claim types, one line each (the landing page says the same). */
export const KIND_BLURB = {
  origin: "Where the funds entered the holder's wallet, and what funded that transaction.",
  path: "A disclosed note was spent in the transaction that created the next one.",
  deposit: "A payment the holder made, opened by a sender receipt, paid from disclosed notes.",
  control: "A challenge transaction spent disclosed notes and paid the holder a note whose memo carries your nonce.",
};
/** Every claim type, one line each, for the kind column's tooltip (the landing page lists the first four). */
export const KIND_HELP = {
  ...KIND_BLURB,
  transparent_payment: "A payment the holder made to a transparent address (an exchange deposit, say), from disclosed notes; its address and amount are public.",
};
/** The fragment that opens the committed testnet sample (case/#sample): the README links it. */
export const SAMPLE_FRAGMENT = "sample";
export const SAMPLE_PATH = "fixtures/testnet-dossier.json";
/** The flagship sample: a customer's exchange withdrawal, their deposit back to the exchange, and their challenge answer. */
export const EXCHANGE_SAMPLE = "sample-exchange";
/**
 * The committed samples by fragment: the base dossier (a faucet payment and three payments from it), the exchange
 * deposit review, and one whose funds left to a transparent address and came back.
 */
export const SAMPLES = {
  [SAMPLE_FRAGMENT]: SAMPLE_PATH,
  [EXCHANGE_SAMPLE]: "fixtures/testnet-dossier-exchange.json",
  "sample-transparent": "fixtures/testnet-dossier-transparent-origin.json",
};
/** Per sample, the challenge its control claim answered: the nonce the reviewer issued, and the chain height then (H₀). */
export const SAMPLE_CHALLENGE = {
  [SAMPLE_FRAGMENT]: { nonce: "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8", height: 4421300, network: "test" },
  [EXCHANGE_SAMPLE]: { nonce: "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1", height: 4422294, network: "test" },
  "sample-transparent": { nonce: "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8", height: 4421300, network: "test" },
};
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
 * What a person gave the page: dossier JSON, a case link (…/case/#<base64url>), a bare base64url payload, or a
 * sample's fragment. Returns `{ sample }` (the fragment, a key of SAMPLES), `{ text }` (the dossier JSON as given) or
 * `{ error }`.
 */
export function readDossierInput(raw) {
  // JSON is kept exactly as given, so the report's dossier_sha256 is the sha256 of the holder's file.
  const given = String(raw ?? "");
  let s = given.trim();
  if (!s) return { error: "Nothing to check: paste a dossier, drop its file, or open a case link." };
  if (s.startsWith("{")) return { text: given };
  const hash = s.lastIndexOf("#");
  if (hash >= 0) s = s.slice(hash + 1).trim();
  if (Object.hasOwn(SAMPLES, s)) return { sample: s };
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

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/** "claim #13 (transparent payment)": the core counts claims from 0, the page from 1. */
const claimRef = (n, kind) => `claim #${Number(n) + 1}${kind ? ` (${(KIND_LABEL[kind] ?? kind).toLowerCase()})` : ""}`;
/** The verifier's parse errors (spec/test-vectors/dossier-v1.json parse_cases, and serde's), each as one sentence. */
const PARSE_ERRORS = [
  [/^not JSON|^json: (?:key must be a string|expected|EOF|trailing|control character|invalid escape|invalid number|invalid unicode|lone leading surrogate|recursion limit)/,
    () => "This is not valid JSON: the file may be cut short, or was changed by hand. Ask the holder for the file again."],
  [/unknown variant `([^`]*)`, expected one of `origin`/,
    (m) => `It makes a claim of type “${m[1]}”, which a zeceipt-dossier-v1 dossier does not have (origin, path, deposit, control, transparent_payment): it was made by another tool or version, or edited.`],
  [/unknown variant `([^`]*)`, expected one of `main`/, (m) => `Its network, “${m[1]}”, is not one a dossier can name (main, test or regtest).`],
  [/unknown field `([^`]*)`/, (m) => `It has a field, “${m[1]}”, that a zeceipt-dossier-v1 dossier does not have: it was edited, or made by another tool or version.`],
  [/missing field `([^`]*)`/, (m) => `A field every dossier needs, “${m[1]}”, is missing: the file is incomplete.`],
  [/duplicate field `([^`]*)`/, (m) => `The field “${m[1]}” appears twice: the file was edited.`],
  [/json: invalid (?:type|value|length)/, () => "A field holds the wrong kind of value: the file was edited, or made by another tool."],
  [/claim (\d+) \((\w+)\) needs nk/, (m) => `${cap(claimRef(m[1], m[2]))} needs the nullifier key (nk), which the dossier does not include: ask the holder to build it again.`],
  [/field nk has wrong length|\bnk\b.*(?:hex|length|not a key)/, () => "The nullifier key (nk) is not a 32-byte key: the dossier is damaged, or was edited."],
  [/claim (\d+) \((\w+)\): a nonce of at least 8 characters/,
    (m) => `The nonce in ${claimRef(m[1], m[2])} is shorter than 8 characters, and a reviewer's nonce is longer: it does not answer a real challenge.`],
  [/claim (\d+) \((\w+)\) names no spent note/, (m) => `${cap(claimRef(m[1], m[2]))} names no spent note: a control claim lists the disclosed notes its challenge transaction spent.`],
  [/claim (\d+) \((\w+)\) names no funding note/, (m) => `${cap(claimRef(m[1], m[2]))} names no funding note: without one, nothing ties the payment to the holder.`],
  [/claim (\d+) \((\w+)\): tx is a txid/, (m) => `${cap(claimRef(m[1], m[2]))} does not name its transaction by a valid id (64 lowercase hexadecimal characters).`],
  [/claim (\d+) \((\w+)\) names note "([^"]*)", which the dossier does not disclose/,
    (m) => `${cap(claimRef(m[1], m[2]))} names note ${m[3]}, which the dossier does not include: it is incomplete, or was edited.`],
  [/claim (\d+) \((\w+)\) names receipt "([^"]*)", which the dossier does not include/,
    (m) => `${cap(claimRef(m[1], m[2]))} names receipt ${m[3]}, which the dossier does not include: it is incomplete, or was edited.`],
  [/claim (\d+) \((\w+)\) lists note (\S+) twice/, (m) => `${cap(claimRef(m[1], m[2]))} lists note ${m[3]} twice: counted twice, it would inflate the amounts.`],
  [/notes (\S+) and (\S+) open the same note/, (m) => `Notes ${m[1]} and ${m[2]} open the same note: counted twice, it would inflate the amounts. The dossier was edited.`],
  [/receipt (\S+) is for another network/, (m) => `Receipt ${m[1]} is for another network than the dossier: they come from different chains.`],
  [/note (\S+): field zdp proof has wrong length/, (m) => `Note ${m[1]}'s opening is damaged: it is not the length a note opening has.`],
  [/note (\S+): unsupported format version "([^"]*)"/, (m) => `Note ${m[1]}'s opening is of a version this page does not read (“${m[2]}”).`],
  [/^(?:Error: )?unsupported format version "([^"]*)"/, (m) => `This is a “${m[1]}” file, and this page reads zeceipt-dossier-v1 dossiers: ask for a v1 dossier, or use a newer zeceipt.`],
  [/at least one claim/, () => "The dossier makes no claim: there is nothing to check."],
];

/**
 * A verifier's parse error as one plain sentence (`text`), with the error as given (`raw`) for a "Technical detail"
 * fold. `known` is false when no sentence fits and `text` only says the dossier could not be read.
 */
export function parseErrorText(error) {
  const raw = String(error ?? "").replace(/^Error: /, "");
  for (const [re, say] of PARSE_ERRORS) {
    const m = re.exec(raw);
    if (m) return { text: say(m), raw, known: true };
  }
  return { text: "The verifier could not read this dossier: see the technical detail.", raw, known: false };
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
  if (n("transparent_payment")) parts.push(plural(n("transparent_payment"), "transparent payment"));
  return listJoin(parts);
}

/** "#2–#5" for consecutive claims, "#2, #4" otherwise (numbered from 1, as the claims table is). */
export function claimNumbers(indices) {
  const xs = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  const run = xs.length > 2 && xs.every((x, k) => k === 0 || x === xs[k - 1] + 1);
  return run ? `#${xs[0]}–#${xs[xs.length - 1]}` : xs.map((x) => `#${x}`).join(", ");
}

/** Deposits whose claim lists no funding note (the core says so in a detail): nothing ties them to the holder. */
export function unboundDeposits(report, dossier) {
  return (report?.claims ?? [])
    .filter((c) => c.kind === "deposit" && (c.details ?? []).some((d) => /^No funding notes are listed/.test(d)))
    .map((c) => ({ index: c.index, receipt: dossier?.claims?.[c.index]?.receipt ?? null }));
}

/** The assurance the report states, or the one it implies (a report from before the field). */
const assuranceOf = (report) => report.assurance ?? (report.all_verified ? (report.controlled ? "verified_with_control" : "verified_history_only") : "not_verified");

/**
 * The case banner: `tone` is ok, partial, pending or bad (the verdict component's classes); the words carry the
 * meaning, the colour only follows them. Green needs the report's `assurance` to be verified_with_control: every claim
 * verified and a control claim answering the nonce the reviewer issued. Every claim verified without that is amber,
 * with the reason. `dossier` (optional) names a deposit's receipt.
 */
export function caseVerdict(report, dossier = null) {
  if (!report || report.error || !Array.isArray(report.claims)) {
    const p = report?.error ? parseErrorText(report.error) : null;
    return { tone: "bad", headline: "Not a readable dossier", sub: p ? p.text : "The verifier could not read it.", raw: p?.raw ?? null, counts: null };
  }
  const v = gradedVerdict(report, dossier);
  const unbound = unboundDeposits(report, dossier);
  if (unbound.length) {
    const names = unbound.map((u) => `${claimRef(u.index, "deposit")}${u.receipt ? `, receipt ${u.receipt}` : ""}`);
    v.sub += ` ${cap(listJoin(names))} ${unbound.length === 1 ? "lists" : "list"} no funding notes: nothing ties ${unbound.length === 1 ? "that payment" : "those payments"} to the holder's other notes.`;
  }
  return v;
}

function gradedVerdict(report, dossier) {
  const counts = statusCounts(report.claims);
  const n = report.claims.length;
  if (counts.failed > 0) {
    const one = counts.failed === 1 ? report.claims.find((c) => c.status === "failed") : null;
    return {
      tone: "bad",
      headline: `${plural(counts.failed, "claim")} failed`,
      sub: `${counts.verified} of ${n} verified${counts.not_checked ? `, ${counts.not_checked} not checked` : ""}. A failed claim is not supported by the chain: ${one ? `${claimRef(one.index, one.kind)}: ${one.summary}` : "its row below says why."}`,
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
  const all = n === 1 ? "The claim holds" : `All ${n} claims hold`;
  if (assuranceOf(report) === "verified_with_control") {
    const h0 = report.issued_at_height;
    return {
      tone: "ok",
      headline: "Verified, with control",
      sub: `${all} against the chain (${kindBreakdown(report.claims)}), and the control claim answers the nonce you issued${h0 != null ? `, after height ${h0}` : ""}: the holder could spend these funds after your challenge.`,
      counts,
    };
  }
  const hasControl = report.claims.some((c) => c.kind === "control") || (dossier?.claims ?? []).some((c) => c.type === "control");
  return {
    tone: "partial",
    headline: "Claims verified — control not shown",
    sub: hasControl
      ? `${all} against the chain (${kindBreakdown(report.claims)}), but the control claim is not matched to your nonce: no expected nonce was given. Enter the nonce you issued under “Challenge the holder”.`
      : `${all} against the chain (${kindBreakdown(report.claims)}), but the dossier has no control claim: nothing shows the holder can spend these funds now. Send them a challenge (below).`,
    reason: hasControl ? "no-nonce" : "no-control",
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
    const back = [...new Set(t.map((i) => i.paid_in_claim).filter((k) => k != null))];
    return `From ${plural(t.length, "transparent input")}${total}${addrs.length ? `, paid from ${addrs.join(", ")}` : ""}${back.length ? `; ${returnedText(back)}` : ""}.`;
  }
  return `From shielded funds of an undisclosed sender (the transaction has ${plural(funding.shielded_actions ?? 0, "shielded action")}${funding.sapling_spends ? ` and ${plural(funding.sapling_spends, "Sapling spend")}` : ""}).`;
}

/** "returned from claim #13 (paid by the holder)": an origin's transparent input the holder paid in an earlier claim. */
export const returnedText = (indices) => `returned from ${indices.length === 1 ? "claim" : "claims"} ${claimNumbers(indices)} (paid by the holder)`;

/**
 * The funds flow, one step per transaction, oldest first: where funds entered (origin), each transaction that moved
 * or paid them (path hops, deposits and transparent payments), and the control answer. Each step names its transaction
 * and height, the disclosed notes it spent and created, the payments it made, and one edge per claim with that claim's
 * status; path claims from one note in one transaction share an edge ("n1 → n2, n3, n4, n5 in fcfde625…7f0b"), with
 * `indices` naming them all.
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
      s.edges.push({ index: i, kind: "path", status, from: c.from, to: c.to, label: `${c.from} → ${c.to}` });
    } else if (c.type === "deposit") {
      const rc = receipts[c.receipt] ?? {};
      s = step(rc.txid);
      s.stages.add("deposit");
      for (const f of c.funded_by ?? []) addUnique(s.spent, note(f));
      const p = payments[c.receipt] ?? {};
      const value = p.value_zat ?? r.value_zat;
      s.payments.push({ id: c.receipt, value_zat: value ?? null, value: amountText(value, network), recipient: p.recipient ?? null, memo: p.memo ?? null, transparent: false });
      s.edges.push({ index: i, kind: "deposit", status, label: `${(c.funded_by ?? []).join(", ") || "undisclosed notes"} → payment ${c.receipt}` });
    } else if (c.type === "transparent_payment") {
      s = step(c.tx);
      s.stages.add("transparent");
      for (const f of c.funded_by ?? []) addUnique(s.spent, note(f));
      s.payments.push({ id: `#${i + 1}`, value_zat: r.value_zat ?? null, value: amountText(r.value_zat, network), recipient: r.paid_to ?? null, memo: null, transparent: true, output: c.output });
      s.edges.push({ index: i, kind: "transparent_payment", status, label: `${(c.funded_by ?? []).join(", ")} → ${r.paid_to ?? `transparent output ${c.output}`}` });
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
    s.edges = mergePaths(s.edges, s.txid);
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

/** Path edges from one note, in one transaction, as one edge: "n1 → n2, n3, n4, n5 in fcfde625…7f0b". */
function mergePaths(edges, txid) {
  const out = [];
  for (const e of edges) {
    const m = e.kind === "path" ? out.find((x) => x.kind === "path" && x.from === e.from) : null;
    if (m) {
      m.indices.push(e.index);
      m.tos.push(e.to);
      m.status = worst([m.status, e.status]);
    } else out.push({ ...e, indices: [e.index], ...(e.kind === "path" ? { tos: [e.to] } : {}) });
  }
  for (const e of out) if (e.kind === "path") e.label = `${e.from} → ${e.tos.join(", ")} in ${shortTxid(txid)}`;
  return out;
}

function stepTitle(s) {
  if (s.stage === "control") return "Control: the holder answered the challenge";
  if (s.stage === "origin") return "Origin: funds enter the holder's wallet";
  const t = s.payments.some((p) => p.transparent);
  const z = s.payments.some((p) => !p.transparent);
  const paid = t && z ? "paid out (shielded and transparent)" : t ? "paid out (transparent)" : "paid out";
  if (s.payments.length && s.created.length) return `Moved within the wallet, and ${paid}`;
  if (s.payments.length) return cap(paid);
  return "Moved within the wallet";
}

/** One line for a note chip: "n2 · 0.2474375 TAZ". */
export const noteLabel = (n) => `${n.id} · ${n.error ? "does not open" : n.value}`;

/**
 * Whether the dossier's control claim answers the nonce the reviewer issued (typed into the page, or generated there);
 * `issued` is empty or null when none was given.
 */
export function nonceCheck(dossier, report, issued) {
  const controls = (dossier?.claims ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.type === "control");
  if (!controls.length) {
    return { state: "no-control", text: "This dossier has no control claim: it does not show that the holder can spend these funds now. Send the holder a challenge." };
  }
  const nonces = controls.map(({ c }) => String(c.nonce).trim());
  const mine = String(issued ?? "").trim();
  if (!mine) {
    return { state: "not-generated", text: `The control claim answers nonce ${nonces.join(", ")}. Enter the nonce you issued under “Challenge the holder”, and the page checks the claim against it.` };
  }
  const hit = controls.find(({ c }) => String(c.nonce).trim() === mine);
  if (hit) {
    const r = report?.claims?.[hit.i];
    const h0 = report?.issued_at_height;
    return r?.status === "verified"
      ? { state: "match", text: `The control claim answers the nonce you issued (${mine})${h0 != null ? ` at height ${h0}` : ""}, and it verified.` }
      : { state: "match-unverified", text: `The control claim names the nonce you issued (${mine}), but it did not verify: ${r?.summary ?? "it was not checked."}` };
  }
  return { state: "mismatch", text: `The control claim answers ${nonces.join(", ")}, not the nonce you issued (${mine}). It may answer an earlier challenge, or someone else's: ask the holder to answer yours.` };
}

/** A fresh reviewer nonce from 16 random bytes (the page passes crypto.getRandomValues' output). */
export function newNonce(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new Error("16 random bytes");
  return NONCE_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "2026-09-30 12:40 UTC". */
export const utcText = (iso) => `${String(iso).slice(0, 16).replace("T", " ")} UTC`;

/** A height as typed: a whole number of at least 1, or null (blank, or not a height). */
export function heightInput(text) {
  const s = String(text ?? "").trim().replace(/[,_ ]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The challenge as the reviewer files it: the nonce, the height it was issued at (H₀), the time and the network.
 * `issuedAt` is when it was generated (ISO), or null when it was typed in (the time of the copy is given instead).
 */
export function challengeRecordText({ nonce, height, network, issuedAt = null, now }) {
  return [
    "Zeceipt challenge (source-of-funds dossier)",
    `Nonce: ${nonce || "(none)"}`,
    `Issued at height (H0): ${height ?? "(not recorded)"}`,
    issuedAt ? `Issued: ${utcText(issuedAt)}` : `Recorded: ${utcText(now)} (the nonce was entered, not generated, in the page)`,
    `Network: ${NETWORK_NAME[network] ?? network ?? "unknown"}`,
  ].join("\n");
}

/** Where the offline check came from: "offline, from 5 transaction files". */
export const offlineText = (n) => `offline, from ${plural(n, "transaction file")}: no node was asked, so inclusion in the chain (and each height) was not checked`;

/**
 * A file of transactions for an offline check: `<txid>.hex` (or .txt), hex inside. Returns `{ txid, hex }` or
 * `{ error }`. The txid comes from the name; the verifier recomputes each transaction's txid from its bytes and flags
 * one filed under another.
 */
export function txFile(name, text) {
  const m = /^([0-9a-fA-F]{64})(?:\.(?:hex|txt))?$/.exec(String(name ?? "").trim());
  if (!m) return { error: `${name}: not named <txid>.hex` };
  const hex = String(text ?? "").replace(/\s+/g, "");
  if (!hex || hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex)) return { error: `${name}: not a transaction in hex` };
  return { txid: m[1].toLowerCase(), hex: hex.toLowerCase() };
}

const sum = (xs) => xs.reduce((a, x) => a + x, 0);

/**
 * The decision summary above the case: what arrived at the origins (by where it came from), what was paid out
 * (deposits and transparent payments), what the holder showed they control, and the claims by status. Each item is
 * `{ key, value, detail }`.
 */
export function decisionSummary(dossier, report) {
  const net = report?.network ?? dossier?.network;
  const claims = report?.claims ?? [];
  const notes = report?.notes ?? {};
  const items = [];

  const origins = claims.filter((c) => c.kind === "origin").map((c) => {
    const id = dossier?.claims?.[c.index]?.note;
    const f = c.funding;
    const t = f?.transparent_inputs ?? [];
    const kind = !f ? "unknown" : f.from_disclosed?.length ? "disclosed" : t.some((i) => i.paid_in_claim != null) ? "returned" : t.length ? "transparent" : "shielded";
    return { id, status: c.status, zat: notes[id]?.value_zat ?? null, kind };
  });
  if (origins.length) {
    const words = { shielded: "from an undisclosed shielded sender", transparent: "from transparent inputs", returned: "returned from the holder's own transparent payment", disclosed: "from this dossier's notes", unknown: "not established" };
    const parts = Object.keys(words).map((k) => [k, origins.filter((o) => o.kind === k)]).filter(([, os]) => os.length)
      .map(([k, os]) => `${amountText(sum(os.map((o) => o.zat ?? 0)), net)} ${words[k]}`);
    const weak = origins.filter((o) => o.status !== "verified");
    items.push({
      key: "Arrived at origins",
      value: `${amountText(sum(origins.map((o) => o.zat ?? 0)), net)} in ${plural(origins.length, "note")}`,
      detail: `${listJoin(parts)}${weak.length ? `; not verified: ${weak.map((o) => `${o.id} (${(STATUS_LABEL[o.status] ?? o.status).toLowerCase()})`).join(", ")}` : ""}.`,
    });
  }

  const pays = claims.filter((c) => c.kind === "deposit" || c.kind === "transparent_payment");
  const valued = (k) => pays.filter((c) => c.kind === k && c.value_zat != null);
  const dep = valued("deposit"), tp = valued("transparent_payment");
  const unvalued = pays.length - dep.length - tp.length;
  items.push({
    key: "Paid out",
    value: pays.length ? `${amountText(sum([...dep, ...tp].map((c) => c.value_zat)), net)} in ${plural(pays.length, "payment")}` : "None claimed",
    detail: pays.length
      ? `${listJoin([
        ...(dep.length ? [`${plural(dep.length, "shielded payment")} with a receipt (${amountText(sum(dep.map((c) => c.value_zat)), net)})`] : []),
        ...(tp.length ? [`${plural(tp.length, "transparent payment")} (${amountText(sum(tp.map((c) => c.value_zat)), net)})`] : []),
      ]) || "no amount could be read"}${unvalued ? `; ${plural(unvalued, "payment")} not counted (not verified)` : ""}.`
      : "The dossier claims no payment.",
  });

  const controls = claims.filter((c) => c.kind === "control");
  const shown = controls.filter((c) => c.status === "verified");
  let control;
  if (report?.controlled && shown.length) {
    const spent = shown.flatMap((c) => dossier?.claims?.[c.index]?.spent ?? []);
    const heights = shown.map((c) => notes[dossier?.claims?.[c.index]?.reply]?.height).filter((h) => h != null);
    control = {
      value: amountText(sum(shown.map((c) => c.value_zat ?? 0)), net),
      detail: `${spent.join(", ")}, spent in answer to your nonce${heights.length ? ` at height ${heights.join(", ")}` : ""}${report.issued_at_height != null ? ` (issued at height ${report.issued_at_height})` : ""}.`,
    };
  } else {
    control = {
      value: "Not shown",
      detail: !controls.length ? "The dossier has no control claim."
        : !shown.length ? "The control claim did not verify."
          : "A control claim verified, but not against your nonce: enter the nonce you issued.",
    };
  }
  items.push({ key: "Under control", ...control });

  const counts = statusCounts(claims);
  const order = ["verified", "failed", "not_checked", "unproven"];
  items.push({
    key: "Claims",
    value: order.filter((k) => counts[k]).map((k) => `${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`).join(" · ") || "none",
    detail: `${plural(claims.length, "claim")}: ${kindBreakdown(claims)}.`,
  });
  return items;
}

/** The case facts, as key–value rows; the holder's own statements are labelled as such. */
export function caseFacts(dossier, report, meta = {}) {
  const rows = [];
  rows.push(["Subject (unauthenticated)", dossier?.subject ? dossier.subject : "(none given)"]);
  rows.push(["Network", NETWORK_NAME[report?.network] ?? report?.network ?? "unknown"]);
  if (dossier?.created) rows.push(["Built (per the holder)", utcText(dossier.created)]);
  if (report?.dossier_sha256) rows.push(["Dossier sha256", report.dossier_sha256]);
  if (meta.checkedAt) {
    const where = meta.offline != null ? `, ${offlineText(meta.offline)}` : meta.nodes?.length ? ` against ${meta.nodes.map(nodeHost).join(" and ")}` : ", in this browser";
    rows.push(["Checked", `${utcText(meta.checkedAt)}${where}`]);
  }
  if (report?.issued_at_height != null) rows.push(["Nonce issued at height", String(report.issued_at_height)]);
  return rows;
}

/** The reviewer's case fields (name, case id, date), as typed; blank ones are left out. */
const caseFieldRows = (f = {}) => [["Reviewer", f.reviewer], ["Case id", f.caseId], ["Case date", f.date]].filter(([, v]) => String(v ?? "").trim());

/** The plain-text case summary a reviewer pastes into their case notes. */
export function caseSummaryText(dossier, report, meta = {}) {
  const v = caseVerdict(report, dossier);
  const lines = [`Zeceipt case review: ${v.headline}`, v.sub];
  for (const [k, val] of caseFieldRows(meta.caseFields)) lines.push(`${k}: ${String(val).trim()}`);
  for (const [k, val] of caseFacts(dossier, report, meta)) lines.push(`${k}: ${val}`);
  if (meta.wasmSha256) lines.push(`Verifier: zeceipt_wasm_bg.wasm sha256 ${meta.wasmSha256}`);
  if (meta.nonce) lines.push(`Control: ${meta.nonce.text}`);
  if (v.counts) {
    lines.push("", "Decision summary:");
    for (const d of decisionSummary(dossier, report)) lines.push(`- ${d.key}: ${d.value}. ${d.detail}`);
  }
  lines.push("", "Claims:");
  for (const r of claimRows(report)) lines.push(`${r.number}. ${r.kindLabel}, ${r.statusLabel.toLowerCase()}: ${r.summary}`);
  if (report?.disclosed?.length) lines.push("", "The holder disclosed:", ...report.disclosed.map((d) => `- ${d}`));
  if (report?.does_not_prove?.length) lines.push("", "This does not prove:", ...report.does_not_prove.map((d) => `- ${d}`));
  return lines.join("\n");
}

/**
 * The report as downloaded for a case file: the verifier's report, plus when, how and by whom it was checked (the
 * nodes, or the files offline; the verifier and its wasm's sha256; the nonce the reviewer entered; their case fields).
 */
export function reportForDownload(report, meta = {}) {
  const f = meta.caseFields ?? {};
  const field = (v) => String(v ?? "").trim() || null;
  return {
    ...report,
    case: {
      checked_at: meta.checkedAt ?? null,
      nodes: meta.nodes ?? [],
      offline_files: meta.offline ?? null,
      verifier: meta.verifier ?? null,
      verifier_wasm_sha256: meta.wasmSha256 ?? null,
      reviewer_nonce: meta.nonce ? { state: meta.nonce.state, issued: field(meta.issued), issued_at_height: report?.issued_at_height ?? null } : null,
      reviewer: field(f.reviewer),
      case_id: field(f.caseId),
      case_date: field(f.date),
    },
  };
}

export const reportFileName = (report) => `zeceipt-case-${String(report?.dossier_sha256 ?? "report").slice(0, 12)}.json`;
