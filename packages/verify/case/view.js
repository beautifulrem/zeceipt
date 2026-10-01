// Pure display logic for the case review page (case/index.html) and the dossier builder (build/index.html): a dossier
// (zeceipt-dossier-v1, spec/dossier-v1.md) and its report (zeceipt-dossier-report-v1) in, plain strings and plain data
// out. No DOM here; case/page.js and build/page.js render these with textContent only. Tested by test/dossier-view.mjs.
import { valueParts, nodeHost, heightText } from "../r/view.js";

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
/** The same customer proving control unprompted: a control that answers a block's hash (a beacon), no nonce issued. */
export const BEACON_SAMPLE = "sample-beacon";
/**
 * The committed samples by fragment: the base dossier (a faucet payment and three payments from it), the exchange
 * deposit review, one whose funds left to a transparent address and came back, and the exchange customer's beacon
 * control.
 */
export const SAMPLES = {
  [SAMPLE_FRAGMENT]: SAMPLE_PATH,
  [EXCHANGE_SAMPLE]: "fixtures/testnet-dossier-exchange.json",
  "sample-transparent": "fixtures/testnet-dossier-transparent-origin.json",
  [BEACON_SAMPLE]: "fixtures/testnet-dossier-beacon.json",
};
/**
 * Per sample, the challenge its control claim answered: the nonce the reviewer issued, and the chain height then (H₀).
 * The beacon sample has none: its control answers a block's hash, which no reviewer issued.
 */
export const SAMPLE_CHALLENGE = {
  [SAMPLE_FRAGMENT]: { nonce: "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8", height: 4421300, network: "test" },
  [EXCHANGE_SAMPLE]: { nonce: "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1", height: 4422294, network: "test" },
  "sample-transparent": { nonce: "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8", height: 4421300, network: "test" },
};
/**
 * What a sample's verdict should be read as, when it is amber for a reason the sample is meant to show: the faucet
 * sample's origin is the testnet faucet, an undisclosed shielded sender, so its funds are not fully explained.
 */
export const SAMPLE_EXPECTED = {
  [SAMPLE_FRAGMENT]: { reason: "partly-explained", text: "That is the expected result for this sample: its funds came from the testnet faucet, which pays from the shielded pool, so the chain cannot show their source." },
};
export const NONCE_PREFIX = "zeceipt-challenge-";
export const BEACON_PREFIX = "zeceipt-beacon-";

/**
 * The block a beacon nonce names (`zeceipt-beacon-<height>-<block hash, display hex>`, spec §7.4): `{ height, hash }`,
 * or null for any other nonce. As the core's parse_beacon reads it.
 */
export function beaconOf(nonce) {
  const s = String(nonce ?? "").trim();
  if (!s.startsWith(BEACON_PREFIX)) return null;
  const m = /^(\d+)-([0-9a-fA-F]{64})$/.exec(s.slice(BEACON_PREFIX.length));
  if (!m) return null;
  const height = Number(m[1]);
  return Number.isSafeInteger(height) ? { height, hash: m[2].toLowerCase() } : null;
}

/** The beacon nonce for a block: `zeceipt-beacon-<height>-<hash>`. */
export const beaconNonce = (height, hash) => `${BEACON_PREFIX}${height}-${String(hash).toLowerCase()}`;

/** A block's time (Unix seconds) as the page writes times: "2026-10-01 06:49 UTC". */
export const blockTimeText = (time) => (Number.isFinite(time) ? utcText(new Date(time * 1000).toISOString()) : "");

/**
 * The beacon a verified control answers, from the report: `{ height, hash, time }` (hash and time from the core's
 * detail, "… beacon of block H (hash 00000f97…4b7f, mined at Unix time T) …"), or null.
 */
export function reportBeacon(report) {
  const height = report?.beacon_height;
  if (height == null) return null;
  const detail = (report.claims ?? []).filter((c) => c.kind === "control").flatMap((c) => c.details ?? []).find((d) => d.includes(`beacon of block ${height} `)) ?? "";
  const m = /\(hash (\S+), mined at Unix time (\d+)\)/.exec(detail);
  return { height, hash: m?.[1] ?? null, time: m ? Number(m[2]) : null };
}

/** "block 4426425 (mined 2026-10-01 06:49 UTC)": a beacon's block, for the page's sentences. */
const beaconBlockText = (b) => `block ${b.height}${Number.isFinite(b.time) ? ` (mined ${blockTimeText(b.time)})` : ""}`;

/**
 * A nonce as the page shows it before the reviewer has entered theirs: its first characters only ("a nonce beginning
 * zeceipt-challenge-322b…"), so the dossier's own nonce is never there to copy into "Nonce you issued".
 */
export function maskNonce(nonce) {
  const n = String(nonce ?? "").trim();
  const keep = n.startsWith(NONCE_PREFIX) ? NONCE_PREFIX.length + 4 : Math.min(4, Math.floor(n.length / 4));
  return `${n.slice(0, keep)}…`;
}

/** `text` with each of `nonces` (the dossier's control nonces) shortened by maskNonce. */
export function maskNonces(text, nonces = []) {
  let t = String(text ?? "");
  for (const n of nonces.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 8)) t = t.split(n).join(maskNonce(n));
  return t;
}

/** The dossier's control nonces that a reviewer issued (a beacon nonce is a block's hash, public: it is never kept back). */
export const dossierNonces = (dossier) => (dossier?.claims ?? []).filter((c) => c.type === "control").map((c) => String(c.nonce ?? "").trim()).filter((n) => n && !beaconOf(n));

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

/**
 * A total as the decision summary shows it: "—" when no amount is known (never "0.0 ZEC" for amounts nobody could
 * read), "at least 0.2 TAZ" when only some are known.
 */
export function totalText(values, network) {
  const known = values.filter((v) => v !== undefined && v !== null);
  if (!known.length) return "—";
  const t = amountText(known.reduce((a, v) => a + v, 0), network);
  return known.length < values.length ? `at least ${t}` : t;
}

/** An amount the core wrote as decimal ZEC ("0.09985000") in zatoshi, or null. */
export function zatFromDecimal(text) {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(String(text ?? "").trim());
  return m ? Number(BigInt(m[1]) * 100_000_000n + BigInt((m[2] ?? "").padEnd(8, "0"))) : null;
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
    (m) => `It makes a claim of type “${m[1]}”, which a zeceipt-dossier-v1 dossier does not have (origin, path, deposit, control, transparent_payment): it was made by another tool or version, or edited. If this page was open while the site was updated, reload it first.`],
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
 * Per claim, the funding notes the report lists as untraced (no chain of verified path claims leads them back to an
 * origin claim, spec §5.6): a deposit's or transparent payment's `funded_by`, a control's `spent`.
 */
export function claimUntraced(dossier, report) {
  const untraced = new Set(report?.untraced ?? []);
  const out = {};
  (dossier?.claims ?? []).forEach((c, i) => {
    const funds = c.type === "control" ? c.spent : c.type === "deposit" || c.type === "transparent_payment" ? c.funded_by : null;
    const hit = (funds ?? []).filter((n) => untraced.has(n));
    if (hit.length) out[i] = hit;
  });
  return out;
}

/**
 * Why an origin claim names no source (spec §5.6), from its funding and the core's detail: it spends disclosed notes
 * (a hop), its transparent inputs' previous transactions are missing, or it was paid by an undisclosed shielded sender.
 * `kind` is "hop", "missing" or "shielded".
 */
function originReason(claim) {
  const f = claim?.funding ?? {};
  const details = (claim?.details ?? []).join(" ");
  if (f.from_disclosed?.length || /spends disclosed notes/.test(details)) {
    return { kind: "hop", text: `it spends disclosed notes${f.from_disclosed?.length ? ` (${f.from_disclosed.join(", ")})` : ""}, so it is a hop, not a source` };
  }
  if (/previous transactions were not supplied/.test(details)) return { kind: "missing", text: "its transparent inputs' previous transactions are missing" };
  return { kind: "shielded", text: "an undisclosed shielded sender" };
}

/**
 * The origins the report lists in `unexplained_origins` (spec §5.6: their transactions name no source), each as
 * `{ index, note, kind, reason }`; with no dossier to name the origin claims' notes, `index` is null and the reason
 * generic.
 */
export function unexplainedOrigins(dossier, report) {
  const ids = report?.unexplained_origins ?? [];
  if (!ids.length) return [];
  const out = [];
  for (const c of report?.claims ?? []) {
    const note = dossier?.claims?.[c.index]?.note;
    if (c.kind !== "origin" || !ids.includes(note) || out.some((o) => o.note === note)) continue;
    const r = originReason(c);
    out.push({ index: c.index, note, kind: r.kind, reason: r.text });
  }
  for (const id of ids) if (!out.some((o) => o.note === id)) out.push({ index: null, note: id, kind: null, reason: null });
  return out;
}

/** "origin n1 names no source: an undisclosed shielded sender". */
const originGapText = (o) => `origin ${o.note} names no source${o.reason ? `: ${o.reason}` : ""}`;

/**
 * What keeps the claims from explaining the funds (spec §5.6), as phrases: the untraced notes, the origins that name
 * no source, the least value paid from notes the dossier does not disclose, and the transparent inputs of unknown
 * value. Empty when every payment and control traces back to an origin that names its source and no transaction spent
 * undisclosed money. `dossier` (optional) names each origin's reason.
 */
export function explanationGaps(report, dossier = null) {
  const gaps = [];
  const u = report?.untraced ?? [];
  if (u.length) gaps.push(`${u.length === 1 ? "note" : "notes"} ${listJoin(u)} ${u.length === 1 ? "is" : "are"} not traced back to an origin (no chain of path claims leads from an origin claim to ${u.length === 1 ? "it" : "them"})`);
  for (const o of unexplainedOrigins(dossier, report)) gaps.push(originGapText(o));
  if (report?.undisclosed_input_min_zat > 0) gaps.push(`at least ${amountText(report.undisclosed_input_min_zat, report.network)} came from notes the dossier does not disclose`);
  const v = report?.unvalued_inputs ?? 0;
  if (v > 0) gaps.push(`${plural(v, "transparent input")} of unknown value (${v === 1 ? "its previous transaction was" : "their previous transactions were"} not found)`);
  return gaps;
}

/** A report from a verifier older than the page's samples: it could not read one of them (the page was open during an update). */
export const STALE_VERIFIER = /unknown variant|unknown field|unsupported format version/;

/**
 * The case banner: `tone` is ok, partial, pending or bad (the verdict component's classes); the words carry the
 * meaning, the colour only follows them. Green needs the report's `assurance` to be verified_with_control: every claim
 * verified against the chain, every payment's and the control's funds traced to an origin, nothing paid from
 * undisclosed notes, and a control claim answering the nonce the reviewer issued. Every claim verified without that is
 * amber, with the reason. `dossier` (optional) names a deposit's receipt; `opts.deposit` is depositCheck's result;
 * `opts.sample` is the fragment of one of this site's samples (which the verifier must read), or null.
 */
export function caseVerdict(report, dossier = null, opts = {}) {
  if (!report || report.error || !Array.isArray(report.claims)) {
    const p = report?.error ? parseErrorText(report.error) : null;
    if (opts.sample && p && STALE_VERIFIER.test(p.raw)) {
      return { tone: "pending", headline: "Reload the page", count: null, line: "This page's verifier is older than its sample dossier.", sub: "This page's verifier is older than its sample dossier: the site was updated while the page was open, or the browser kept an old copy of the verifier. Reload the page.", raw: p.raw, counts: null, reason: "stale" };
    }
    const sub = p ? p.text : "The verifier could not read it.";
    return { tone: "bad", headline: "Not a readable dossier", count: null, line: sub, sub, raw: p?.raw ?? null, counts: null };
  }
  const v = gradedVerdict(report, dossier);
  // A sample that is amber on purpose says so (the faucet sample: its origin is an undisclosed shielded sender).
  const expected = typeof opts.sample === "string" && Object.hasOwn(SAMPLE_EXPECTED, opts.sample) ? SAMPLE_EXPECTED[opts.sample] : null;
  if (expected && v.reason === expected.reason) v.sub += ` ${expected.text}`;
  if (opts.deposit?.state === "paid" && v.tone !== "bad") v.sub += ` ${depositLineText(opts.deposit)}`;
  const unbound = unboundDeposits(report, dossier);
  if (unbound.length) {
    const names = unbound.map((u) => `${claimRef(u.index, "deposit")}${u.receipt ? `, receipt ${u.receipt}` : ""}`);
    v.sub += ` ${cap(listJoin(names))} ${unbound.length === 1 ? "lists" : "list"} no funding notes: nothing ties ${unbound.length === 1 ? "that payment" : "those payments"} to the holder's other notes.`;
  }
  return v;
}

/** "4 of 4 claims verified": the count beside the verdict (offline, "consistent with your files"). */
export function verdictCount(counts, n, offline = false) {
  return `${counts.verified} of ${plural(n, "claim")} ${offline ? "consistent with your files" : "verified"}`;
}

/** A sentence's first clause, for a one-line summary: up to its first full stop. */
const firstSentence = (t) => { const m = /^(.*?[.!?])(\s|$)/.exec(String(t ?? "")); return m ? m[1] : String(t ?? ""); };

function gradedVerdict(report, dossier) {
  const counts = statusCounts(report.claims);
  const n = report.claims.length;
  const count = verdictCount(counts, n, report.anchored === false && report.all_verified);
  // Offline (transactions from files, no heights), nothing was checked against the chain, so no sentence says it was.
  const against = report.anchored === false ? "the transactions you loaded" : "the chain";
  if (counts.failed > 0) {
    const one = counts.failed === 1 ? report.claims.find((c) => c.status === "failed") : null;
    return {
      tone: "bad",
      headline: `${plural(counts.failed, "claim")} failed`,
      count,
      line: one ? `${cap(claimRef(one.index, one.kind))}: ${firstSentence(one.summary)}` : `${plural(counts.failed, "claim")} do not hold against ${against}: their rows say why.`,
      sub: `${counts.verified} of ${n} verified${counts.not_checked ? `, ${counts.not_checked} not checked` : ""}. A failed claim is not supported by ${against}: ${one ? `${claimRef(one.index, one.kind)}: ${one.summary}` : "its row below says why."}`,
      counts,
    };
  }
  if (counts.not_checked > 0) {
    return {
      tone: "pending",
      headline: "Not all checked",
      count,
      line: `${plural(counts.not_checked, "claim")} not checked yet: a transaction was not found, or is not mined. Check again later.`,
      sub: `${counts.verified} of ${n} verified; ${plural(counts.not_checked, "claim")} could not be checked yet (a transaction was not found, or is not mined). Check again later.`,
      counts,
    };
  }
  if (counts.unproven > 0) {
    return {
      tone: "pending",
      headline: `${plural(counts.unproven, "claim")} not proven`,
      count,
      line: "This dossier cannot show it, and waiting will not change that; the row says what would.",
      sub: `${counts.verified} of ${n} verified; ${plural(counts.unproven, "claim")} cannot be shown with this dossier (its row says what would show it). Waiting will not change that.`,
      counts,
    };
  }
  // The deposit address the reviewer assigned, which no verified payment pays (or of another network): the core makes
  // it a problem (spec §7.2), so the case is not verified, whatever the claims say.
  if (report.deposit_address_paid === false) {
    const said = (report.problems ?? []).filter((p) => /deposit address/.test(p));
    const other = said.some((p) => /another network/.test(p));
    return {
      tone: "bad",
      headline: other ? "Deposit address for another network" : "Deposit address not paid",
      count,
      line: other ? "The deposit address you entered is for another network than this dossier." : "No verified payment in this dossier pays the deposit address you assigned.",
      sub: `${said.join(" ") || "No verified payment in this dossier pays the deposit address you assigned."} ${counts.verified === n ? `${n === 1 ? "The claim verifies" : `All ${n} claims verify`}` : `${counts.verified} of ${n} claims verify`} against ${against}, but nothing ties these funds to the customer you assigned that address to.`,
      reason: "deposit-unpaid",
      counts,
    };
  }
  if (!report.all_verified) {
    const problems = report.problems ?? [];
    return {
      tone: "pending",
      headline: "Not all verified",
      count,
      line: firstSentence(problems[0] ?? `${counts.verified} of ${n} verified.`),
      sub: problems.join(" ") || `${counts.verified} of ${n} verified.`,
      counts,
    };
  }
  const all = n === 1 ? "The claim holds" : `All ${n} claims hold`;
  const breakdown = kindBreakdown(report.claims);
  const h0 = report.issued_at_height;
  const hasControl = report.claims.some((c) => c.kind === "control") || (dossier?.claims ?? []).some((c) => c.type === "control");
  const beaconControl = (dossier?.claims ?? []).some((c) => c.type === "control" && beaconOf(c.nonce));
  const beacon = reportBeacon(report);
  const assurance = assuranceOf(report);
  const gaps = explanationGaps(report, dossier);
  if (assurance === "verified_with_control") {
    return {
      tone: "ok",
      headline: "Verified, with control",
      count,
      line: beacon
        ? `The control answers the hash of block ${heightText(beacon.height)}${Number.isFinite(beacon.time) ? `, mined ${blockTimeText(beacon.time)}` : ""}: judge whether that is recent enough.`
        : `The control claim answers the nonce you issued${h0 != null ? `, after height ${heightText(h0)}` : ""}.`,
      sub: beacon
        ? `${all} against the chain (${breakdown}), and the control claim answers the hash of ${beaconBlockText(beacon)}, a beacon no one could know before that block: the holder could spend these funds after it was mined. No one issued this nonce: judge whether block ${beacon.height} is recent enough for this case.`
        : `${all} against the chain (${breakdown}), and the control claim answers the nonce you issued${h0 != null ? `, after height ${h0}` : ""}: the holder could spend these funds after your challenge.`,
      counts,
    };
  }
  if (assurance === "consistent_offline") {
    const control = report.controlled
      ? " The control claim answers the nonce you issued, but without heights nothing shows when it was mined."
      : beaconControl ? " The control claim answers a block's hash (a beacon), but without heights nothing shows it was made after that block."
        : hasControl ? " The control claim is not matched to your nonce." : " The dossier has no control claim.";
    return {
      tone: "partial",
      headline: "Not checked against the chain",
      count,
      line: "No node was asked: whether these transactions are in the chain, and at which heights, is not checked.",
      sub: `${n === 1 ? "The claim is consistent" : `All ${n} claims are consistent`} with the transaction files you loaded (${breakdown}), but no node was asked, so whether these transactions are in the chain, and at which heights, was not checked: a holder can send fabricated files. Load only files you fetched from a node yourself, or check online.${gaps.length ? ` Also, the claims do not explain all of the funds: ${listJoin(gaps)}.` : ""}${control}`,
      reason: "offline",
      counts,
    };
  }
  if (assurance === "verified_partly_explained") {
    const control = report.controlled
      ? beacon ? ` The control claim answers the hash of ${beaconBlockText(beacon)}: judge whether that block is recent enough.` : ` The control claim answers the nonce you issued${h0 != null ? `, after height ${h0}` : ""}.`
      : hasControl ? " The control claim is not matched to your nonce: enter the nonce you issued under “Challenge the holder”." : " The dossier has no control claim.";
    // What to ask for: the history that traces the funds back, and who sent an origin's funds when the chain cannot say.
    const sourceless = unexplainedOrigins(dossier, report).filter((o) => o.kind !== "hop").map((o) => o.note);
    const historyGap = (report.untraced ?? []).length || report.undisclosed_input_min_zat > 0 || report.unvalued_inputs > 0 || unexplainedOrigins(dossier, report).some((o) => o.kind === "hop");
    const asks = [
      ...(historyGap || !sourceless.length ? ["Ask the holder for the missing history (the transactions that lead those funds back to an origin) before you rely on it."] : []),
      ...(sourceless.length ? [`Ask the holder who sent the funds of ${listJoin(sourceless)}, and for their evidence: the chain shows no source for ${sourceless.length === 1 ? "them" : "those"}.`] : []),
    ];
    return {
      tone: "partial",
      headline: "Funds not fully explained",
      count,
      line: historyGap
        ? `${cap(plural(gaps.length, "gap"))} in the funds' history. Ask the holder for the missing transactions.`
        : `The chain shows no source for ${listJoin(sourceless)}. Ask the holder who sent ${sourceless.length === 1 ? "it" : "them"}, with evidence.`,
      sub: `${all} against the chain (${breakdown}), but they do not explain all of the funds: ${listJoin(gaps) || "the report says so"}. ${asks.join(" ")}${control}`,
      reason: "partly-explained",
      counts,
    };
  }
  return {
    tone: "partial",
    headline: hasControl ? "Control not matched" : "No control claim",
    count,
    line: hasControl ? "The control claim is not matched yet: enter the nonce you issued." : "Nothing shows the holder can spend these funds now: send them a challenge.",
    sub: hasControl
      ? `${all} against the chain (${breakdown}), but the control claim is not matched to your nonce: no expected nonce was given. Enter the nonce you issued under “Challenge the holder”.`
      : `${all} against the chain (${breakdown}), but the dossier has no control claim: nothing shows the holder can spend these funds now. Send them a challenge.`,
    reason: hasControl ? "no-nonce" : "no-control",
    counts,
  };
}

/**
 * The exceptions under a verdict: each claim that did not verify, or that verified with a flag (funds not traced or
 * not fully explained), as `{ index, number, kind, status, text }`, for the "Why" list, each linking to its row.
 */
export function exceptionItems(report, dossier = null, opts = {}) {
  const rows = claimRows(report, dossier, opts);
  const out = [];
  for (const r of rows) {
    const warn = r.flags.filter((f) => f.tone === "warn");
    if (r.status !== "verified") out.push({ index: r.index, number: r.number, kind: r.kindLabel, status: r.status, text: firstSentence(r.summary) });
    else if (warn.length) out.push({ index: r.index, number: r.number, kind: r.kindLabel, status: "warn", text: firstSentence(warn[0].text) });
  }
  return out;
}

/**
 * What a claim's row flags beyond its status, as `{ tone, text }` (tone "warn" or "ok"): funding notes not traced to an
 * origin, an origin that names no source, value paid from undisclosed notes (spec §5.6), and a payment to the deposit
 * address the reviewer assigned. `unexplained` is unexplainedOrigins' entry for this claim, if any.
 */
export function claimFlags(claim, untraced = [], deposit = null, network, unexplained = null) {
  const flags = [];
  if (untraced.length) flags.push({ tone: "warn", text: `Not traced to an origin: ${listJoin(untraced)} (no chain of path claims leads ${untraced.length === 1 ? "it" : "them"} back to an origin claim).` });
  if (unexplained) flags.push({ tone: "warn", text: `Names no source: ${unexplained.reason ?? "its transaction does not show where the funds came from"}. The funds of ${unexplained.note} are not explained by this dossier.` });
  if (claim.undisclosed_input_min_zat > 0) flags.push({ tone: "warn", text: `Not fully explained: at least ${amountText(claim.undisclosed_input_min_zat, network)} of what this transaction paid came from notes the dossier does not disclose.` });
  if (deposit?.state === "paid" && deposit.claims.includes(claim.index)) flags.push({ tone: "ok", text: "Pays the deposit address you assigned." });
  return flags;
}

/**
 * The rows of the claims table, in the dossier's order. With `dossier`, each row carries its flags (claimFlags);
 * `opts.deposit` is depositCheck's result, and `opts.mask` (the dossier's nonces) shortens those nonces in the text,
 * until the reviewer has entered the one they issued.
 */
export function claimRows(report, dossier = null, opts = {}) {
  const untraced = dossier ? claimUntraced(dossier, report) : {};
  const unexplained = dossier ? unexplainedOrigins(dossier, report) : [];
  const mask = (t) => maskNonces(t, opts.mask ?? []);
  return (report?.claims ?? []).map((c) => ({
    index: c.index,
    number: c.index + 1,
    kind: c.kind,
    kindLabel: KIND_LABEL[c.kind] ?? c.kind,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status] ?? c.status,
    summary: mask(c.summary),
    details: (c.details ?? []).map(mask),
    flags: claimFlags(c, untraced[c.index] ?? [], opts.deposit ?? null, report?.network, unexplained.find((o) => o.index === c.index) ?? null),
    ...claimWhere(dossier?.claims?.[c.index], c, report, dossier, opts.heights),
  }));
}

/**
 * Where a claim sits, for its row: its transaction and height, the notes it moves from and to (or the payment it
 * makes), and its amount in zatoshi (`zat`, null when not known). Empty without the dossier's claim.
 */
export function claimWhere(c, r, report, dossier, heights = {}) {
  if (!c) return {};
  const notes = report?.notes ?? {};
  const h = (t) => (t ? heights?.[String(t).toLowerCase()] ?? null : null);
  const fromNote = (id) => notes[id] ?? {};
  switch (c.type) {
    case "origin": { const n = fromNote(c.note); return { txid: n.txid ?? null, height: n.height ?? h(n.txid), from: [], to: [c.note], toNotes: true, zat: n.value_zat ?? null }; }
    case "path": { const n = fromNote(c.to); return { txid: n.txid ?? null, height: n.height ?? h(n.txid), from: [c.from], to: [c.to], toNotes: true, zat: n.value_zat ?? null }; }
    case "deposit": { const t = String(dossier?.receipts?.[c.receipt]?.txid ?? "").toLowerCase() || null; return { txid: t, height: h(t), from: c.funded_by ?? [], to: [`payment ${c.receipt}`], toNotes: false, zat: r?.value_zat ?? null }; }
    case "transparent_payment": return { txid: c.tx ?? null, height: h(c.tx), from: c.funded_by ?? [], to: [r?.paid_to ? middle(r.paid_to, 6, 4) : `output ${c.output}`], toNotes: false, zat: r?.value_zat ?? null };
    case "control": { const n = fromNote(c.reply); return { txid: n.txid ?? null, height: n.height ?? h(n.txid), from: c.spent ?? [], to: [c.reply], toNotes: true, zat: r?.value_zat ?? null }; }
    default: return {};
  }
}

const RANK = { verified: 0, not_checked: 1, unproven: 2, failed: 3 };
const worst = (statuses) => statuses.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), "verified");

const CHANGE = /^(\d+(?:\.\d+)?) (?:ZEC|TAZ) of the inputs went back to (\S+) \(output (\d+)\): change to the funder\.$/;
/**
 * An origin's change to its funder, from the core's details ("0.09985000 TAZ of the inputs went back to tmPVt…
 * (output 0): change to the funder."): `[{ value_zat, address, output }]`.
 */
export const funderChange = (details = []) => details.map((d) => CHANGE.exec(d)).filter(Boolean).map((m) => ({ value_zat: zatFromDecimal(m[1]), address: m[2], output: Number(m[3]) }));

/** "of which 0.09985 TAZ went back to tmPVt… (output 0) as change to the funder". */
const changeText = (changes, network) => `of which ${listJoin(changes.map((c) => `${amountText(c.value_zat, network)} went back to ${c.address} (output ${c.output})`))} as change to the funder`;

/**
 * One line on where an origin's funds came from, from the report's `funding`; `details` (the claim's) add the part of
 * the transparent inputs that went back to the funder as change.
 */
export function fundingText(funding, network, details = []) {
  if (!funding) return "Not established: the claim did not verify.";
  if (funding.from_disclosed?.length) return `From disclosed ${funding.from_disclosed.length === 1 ? "note" : "notes"} ${funding.from_disclosed.join(", ")}.`;
  const t = funding.transparent_inputs ?? [];
  if (t.length) {
    const addrs = [...new Set(t.map((i) => i.address).filter(Boolean))];
    const valued = t.every((i) => i.value_zat != null);
    const total = valued ? ` (${amountText(t.reduce((a, i) => a + i.value_zat, 0), network)})` : "";
    const back = [...new Set(t.map((i) => i.paid_in_claim).filter((k) => k != null))];
    const change = funderChange(details);
    return `From ${plural(t.length, "transparent input")}${total}${addrs.length ? `, paid from ${addrs.join(", ")}` : ""}${change.length ? `, ${changeText(change, network)}` : ""}${back.length ? `; ${returnedText(back)}` : ""}.`;
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
  const untraced = new Set(report?.untraced ?? []);
  const flagsOf = claimUntraced(dossier, report);
  // Origins whose transaction names no source (spec §5.6): flagged on the step, the edge and the note received.
  const sourceless = unexplainedOrigins(dossier, report);
  const deposit = extras.deposit ?? null;
  const mask = (t) => (t == null ? t : maskNonces(t, extras.mask ?? []));
  const steps = new Map();
  const note = (id) => ({ id, value_zat: notes[id]?.value_zat, value: amountText(notes[id]?.value_zat, network), txid: notes[id]?.txid, height: notes[id]?.height ?? null, memo: notes[id]?.memo, error: notes[id]?.error });
  // A note a payment or the control spent, which no chain of path claims leads back to an origin (spec §5.6).
  const spentNote = (id) => ({ ...note(id), untraced: untraced.has(id) });
  const step = (txid) => {
    const key = (txid ?? "").toLowerCase();
    if (!steps.has(key)) steps.set(key, { txid: key, height: heights[key] ?? null, stages: new Set(), spent: [], created: [], payments: [], edges: [], funding: [], claims: [], undisclosed_zat: 0, unexplained: [] });
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
      const o = sourceless.find((x) => x.index === i);
      addUnique(s.created, { ...note(c.note), ...(o ? { unexplained: true } : {}) });
      s.funding.push({ note: c.note, text: fundingText(r.funding, network, r.details ?? []), funding: r.funding ?? null });
      s.edges.push({ index: i, kind: "origin", status, label: `Funds reach the holder as ${c.note}`, ...(o ? { unexplained: o.reason ?? "names no source" } : {}) });
      if (o) s.unexplained.push({ note: c.note, reason: o.reason, text: `${cap(originGapText(o))}: this dossier does not explain where these funds came from.` });
    } else if (c.type === "path") {
      s = step(notes[c.to]?.txid);
      s.stages.add("path");
      addUnique(s.spent, spentNote(c.from));
      addUnique(s.created, note(c.to));
      s.edges.push({ index: i, kind: "path", status, from: c.from, to: c.to, label: `${c.from} → ${c.to}` });
    } else if (c.type === "deposit") {
      const rc = receipts[c.receipt] ?? {};
      s = step(rc.txid);
      s.stages.add("deposit");
      for (const f of c.funded_by ?? []) addUnique(s.spent, spentNote(f));
      const p = payments[c.receipt] ?? {};
      const value = p.value_zat ?? r.value_zat;
      s.payments.push({ id: c.receipt, value_zat: value ?? null, value: amountText(value, network), recipient: p.recipient ?? null, memo: p.memo ?? null, transparent: false, assigned: Boolean(deposit?.state === "paid" && deposit.claims.includes(i)) });
      s.edges.push({ index: i, kind: "deposit", status, label: `${(c.funded_by ?? []).join(", ") || "undisclosed notes"} → payment ${c.receipt}` });
    } else if (c.type === "transparent_payment") {
      s = step(c.tx);
      s.stages.add("transparent");
      for (const f of c.funded_by ?? []) addUnique(s.spent, spentNote(f));
      s.payments.push({ id: `#${i + 1}`, value_zat: r.value_zat ?? null, value: amountText(r.value_zat, network), recipient: r.paid_to ?? null, memo: null, transparent: true, output: c.output, assigned: Boolean(deposit?.state === "paid" && deposit.claims.includes(i)) });
      s.edges.push({ index: i, kind: "transparent_payment", status, label: `${(c.funded_by ?? []).join(", ")} → ${r.paid_to ?? `transparent output ${c.output}`}` });
    } else if (c.type === "control") {
      s = step(notes[c.reply]?.txid);
      s.stages.add("control");
      for (const f of c.spent ?? []) addUnique(s.spent, spentNote(f));
      addUnique(s.created, { ...note(c.reply), memo: mask(notes[c.reply]?.memo), reply: true });
      s.nonce = c.nonce;
      s.edges.push({ index: i, kind: "control", status, label: `${(c.spent ?? []).join(", ")} → ${c.reply}, whose memo carries the nonce` });
    } else {
      return;
    }
    const e = s.edges[s.edges.length - 1];
    if (flagsOf[i]) e.untraced = flagsOf[i];
    if (r.undisclosed_input_min_zat > 0) {
      e.undisclosed_zat = r.undisclosed_input_min_zat;
      s.undisclosed_zat = Math.max(s.undisclosed_zat, r.undisclosed_input_min_zat);
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
export function nonceCheck(dossier, report, issued, { source = "typed" } = {}) {
  const controls = (dossier?.claims ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.type === "control");
  if (!controls.length) {
    return { state: "no-control", text: "This dossier has no control claim: it does not show that the holder can spend these funds now. Send the holder a challenge." };
  }
  const nonces = controls.map(({ c }) => String(c.nonce).trim());
  // Until the reviewer's nonce matches, the dossier's own is shown by its first characters only: a reviewer must not
  // be able to copy it from this page into "Nonce you issued". A beacon is a block's hash, public: it is shown whole.
  const masked = listJoin(nonces.map((n) => (beaconOf(n) ? `the beacon ${n}` : `a nonce beginning ${maskNonce(n)}`)));
  const mine = String(issued ?? "").trim();
  // A control answering a beacon (spec §7.4) needs no nonce from the reviewer: the chain dates it.
  const beaconed = controls.map(({ c, i }) => ({ i, b: beaconOf(c.nonce) })).find((x) => x.b);
  if (!mine && beaconed) {
    const { i, b } = beaconed;
    const r = report?.claims?.[i];
    const seen = reportBeacon(report);
    if (r?.status === "verified" && seen?.height === b.height) {
      return { state: "beacon", text: `This control answers the hash of block ${b.height}${Number.isFinite(seen.time) ? ` (time ${blockTimeText(seen.time)})` : ""}: no nonce needs to be entered; judge whether block ${b.height} is recent enough.` };
    }
    if (r?.status === "failed") return { state: "beacon-failed", text: `This control names the hash of block ${b.height}, and it does not verify: ${r.summary}` };
    return { state: "beacon-unchecked", text: `This control answers the hash of block ${b.height}: no nonce needs to be entered, but it is not checked here: ${r?.summary ?? "it was not checked."}` };
  }
  if (!mine) {
    return { state: "not-generated", text: `The control claim answers ${masked}. Enter the nonce you issued, from your case record, to check it.` };
  }
  const hit = controls.find(({ c }) => String(c.nonce).trim() === mine);
  if (hit) {
    const r = report?.claims?.[hit.i];
    const h0 = report?.issued_at_height;
    // A match with a nonce this page did not generate (typed or pasted): a neutral reminder, since a nonce copied from
    // the dossier would match too. The page's own sample challenge is the sample's, filled in by the page.
    const note = source === "typed" ? "You entered this nonce, rather than generating it here: make sure this is the one you sent to the holder, from your case record." : null;
    return r?.status === "verified"
      ? { state: "match", text: `The control claim answers the nonce you issued (${mine})${h0 != null ? ` at height ${h0}` : ""}, and it verified.`, note }
      : { state: "match-unverified", text: `The control claim names the nonce you issued (${mine}), but it did not verify: ${r?.summary ?? "it was not checked."}`, note };
  }
  return { state: "mismatch", text: `The control claim answers ${masked}, not the nonce you issued (${mine}). It may answer an earlier challenge, or someone else's: ask the holder to answer yours.` };
}

/** The dossier's nonces to shorten on the page: all of them, until the reviewer's nonce matches (nonceCheck). */
export const nonceMask = (dossier, check) => (check && (check.state === "match" || check.state === "match-unverified") ? [] : dossierNonces(dossier));

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
 * The challenge as the reviewer files it: the nonce, the height it was issued at (H₀), the time, the network and the
 * deposit address the reviewer assigned to the customer (when given). `issuedAt` is when it was generated (ISO), or
 * null when it was typed in (the time of the copy is given instead).
 */
export function challengeRecordText({ nonce, height, network, issuedAt = null, now, depositAddress = "" }) {
  const lines = [
    "Zeceipt challenge (source-of-funds dossier)",
    `Nonce: ${nonce || "(none)"}`,
    `Issued at height (H0): ${height ?? "(not recorded)"}`,
    issuedAt ? `Issued: ${utcText(issuedAt)}` : `Recorded: ${utcText(now)} (the nonce was entered, not generated, in the page)`,
    `Network: ${NETWORK_NAME[network] ?? network ?? "unknown"}`,
  ];
  if (String(depositAddress ?? "").trim()) lines.push(`Deposit address assigned: ${String(depositAddress).trim()}`);
  return lines.join("\n");
}

// ---- the deposit address the reviewer assigned (spec §7.2's strongest cross-check against a relayed control) ----

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 to bytes (no checksum check), or null. */
function base58(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32mPolymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let c = 1;
  for (const v of values) {
    const top = c >>> 25;
    c = ((c & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) c ^= G[i];
  }
  return c >>> 0;
}
/** A bech32m string to { hrp, data } (checksum checked), or null. */
function bech32m(s) {
  const l = s.toLowerCase();
  const p = l.lastIndexOf("1");
  if (p < 1 || (s !== l && s !== s.toUpperCase())) return null;
  const hrp = l.slice(0, p);
  const d = [...l.slice(p + 1)].map((c) => BECH32.indexOf(c));
  if (d.length < 7 || d.some((x) => x < 0)) return null;
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  if (bech32mPolymod([...expanded, ...d]) !== 0x2bc830a3) return null;
  let acc = 0, bits = 0;
  const out = [];
  for (const x of d.slice(0, -6)) {
    acc = (acc << 5) | x;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return bits >= 5 || (acc & ((1 << bits) - 1)) ? null : { hrp, data: Uint8Array.from(out) };
}
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** Transparent address prefixes (two bytes, hex) and TEX (ZIP 320) human-readable parts, by network. */
const T_PREFIX = { "1cb8": ["main", "p2pkh"], "1cbd": ["main", "p2sh"], "1d25": ["test", "p2pkh"], "1cba": ["test", "p2sh"] };
const TEX_HRP = { tex: "main", textest: "test", texregtest: "regtest" };
const UA_HRP = { u: "main", utest: "test", uregtest: "regtest" };

/**
 * A deposit address as the reviewer typed it: `{ address, network, kind, hash }` (kind p2pkh, p2sh, tex or unified;
 * hash: the 20-byte key or script hash, hex, for the transparent kinds), `{ error }` when it is not one, or null when
 * blank. A TEX address (ZIP 320, the form some exchanges assign) carries the same key hash as the P2PKH address a
 * payment to it shows on chain. The verifier checks the address itself (`expectDepositAddress`); this only says what
 * was typed, and keeps what is not an address out of the check.
 */
export function depositAddressInput(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const bad = { error: "This is not a transparent address (t1…, t3… on mainnet, tm… on testnet), a TEX address (tex1…) or a unified address (u1…, utest1…): it is left out of the check." };
  if (/^tex/i.test(s)) {
    const b = bech32m(s);
    const network = b && TEX_HRP[b.hrp];
    return network && b.data.length === 20 ? { address: s, network, kind: "tex", hash: hexOf(b.data) } : bad;
  }
  if (/^u(?:test|regtest)?1/i.test(s)) {
    const b = bech32m(s);
    const network = b && UA_HRP[b.hrp];
    return network && b.data.length >= 48 ? { address: s, network, kind: "unified", hash: null } : bad;
  }
  const b = /^t[1-9A-HJ-NP-Za-km-z]{33,35}$/.test(s) ? base58(s) : null;
  const known = b?.length === 26 ? T_PREFIX[hexOf(b.slice(0, 2))] : null;
  return known ? { address: s, network: known[0], kind: known[1], hash: hexOf(b.slice(2, 22)) } : bad;
}

/** What the deposit address field says about an address as it is typed ("A transparent address on Zcash testnet."). */
export function depositAddressStatus(a) {
  if (!a) return "";
  if (a.error) return a.error;
  const kind = { tex: "TEX (ZIP 320)", unified: "unified" }[a.kind] ?? "transparent";
  return `A ${kind} address on ${NETWORK_NAME[a.network] ?? a.network}.`;
}

/**
 * Whether a payment to `paidTo` (the core's address: a transparent output's, read from its script, or a receipt's
 * recipient) pays `assigned`.
 */
export function paysAddress(paidTo, assigned) {
  if (!paidTo || !assigned?.address) return false;
  if (assigned.kind === "unified") return paidTo.toLowerCase() === assigned.address.toLowerCase();
  if (assigned.kind !== "tex") return paidTo === assigned.address;
  const p = depositAddressInput(paidTo);
  return Boolean(p && !p.error && p.kind === "p2pkh" && p.network === assigned.network && p.hash === assigned.hash);
}

/**
 * The deposit address check, as the verifier made it (`expectDepositAddress`; the report's `deposit_address_paid` and
 * problems, spec §7.2): `{ state: "paid", claims: [index] }`, with the verified payments that pay it (for the rows'
 * green flag), or `{ state: "unpaid", otherNetwork }`; null when no address was given (or it is not one). A report
 * made without the address (from before the field) is read from its payments.
 */
export function depositCheck(report, assigned) {
  if (!assigned || assigned.error) return null;
  const paying = (report?.claims ?? []).filter((c) => (c.kind === "transparent_payment" || c.kind === "deposit") && c.status === "verified" && paysAddress(c.paid_to, assigned));
  const claims = paying.map((c) => c.index);
  const said = report?.deposit_address_paid;
  const paid = typeof said === "boolean" ? said : claims.length > 0;
  if (paid) return { state: "paid", claims, refs: paying.map((c) => claimRef(c.index, c.kind)), address: assigned.address };
  const otherNetwork = (report?.problems ?? []).some((p) => /deposit address/.test(p) && /another network/.test(p));
  return { state: "unpaid", claims: [], address: assigned.address, otherNetwork };
}

/**
 * The line on the assigned deposit address: in the verdict when paid (green), and under it when not (amber, beside
 * the verifier's problem, which the red verdict states).
 */
export function depositLineText(check) {
  if (!check) return "";
  if (check.state === "paid") {
    const refs = check.refs ?? check.claims.map((i) => claimRef(i));
    const who = refs.length ? `${cap(listJoin(refs))} ${refs.length === 1 ? "pays" : "pay"}` : "A verified payment pays";
    return `${who} the deposit address you assigned (${check.address}): the disclosed funds reached the account you gave this customer.`;
  }
  const first = check.otherNetwork
    ? `The deposit address you entered (${check.address}) is for another network than this dossier: check that it is the address you gave this customer.`
    : `No verified payment in this dossier pays the deposit address you assigned (${check.address}); check that it is the address you gave this customer.`;
  return `${first} A control answer can be relayed: someone who does not hold these funds can pass your nonce to whoever does and show you that party's dossier. A payment to the deposit address you assigned to this customer is what ties the funds to this customer.`;
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
 * The figures under the verdict (the stat row): what arrived at the origins (by where it came from), what was paid
 * out (deposits and transparent payments), whether the claims explain the funds, what the holder showed they control,
 * and the claims by status. Each item is `{ key, value, detail }` (the words, as the case summary writes them), with
 * `zat` (an amount to set as a figure, null when none is known), `atLeast`, `sub` (a short line under the figure) and
 * `tone` (ok or warn, for the figure's mark) where they apply.
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
    return { id, status: c.status, zat: notes[id]?.value_zat ?? null, kind, change: funderChange(c.details ?? []) };
  });
  if (origins.length) {
    const words = { shielded: "from an undisclosed shielded sender", transparent: "from transparent inputs", returned: "returned from the holder's own transparent payment", disclosed: "from this dossier's notes", unknown: "not established" };
    const parts = Object.keys(words).map((k) => [k, origins.filter((o) => o.kind === k)]).filter(([, os]) => os.length)
      .map(([k, os]) => `${k === "unknown" ? "" : `${totalText(os.map((o) => o.zat), net)} `}${words[k]}`);
    const change = origins.flatMap((o) => o.change);
    const weak = origins.filter((o) => o.status !== "verified");
    const known = origins.map((o) => o.zat).filter((z) => z != null);
    items.push({
      key: "Arrived",
      zat: known.length ? sum(known) : null,
      atLeast: known.length > 0 && known.length < origins.length,
      sub: `in ${plural(origins.length, "note")}`,
      value: `${totalText(origins.map((o) => o.zat), net)} in ${plural(origins.length, "note")}`,
      detail: `${listJoin(parts)}${change.length ? `; of the inputs, ${listJoin(change.map((x) => `${amountText(x.value_zat, net)} went back to ${x.address}`))} as change to the funder` : ""}${weak.length ? `; not verified: ${weak.map((o) => `${o.id} (${(STATUS_LABEL[o.status] ?? o.status).toLowerCase()})`).join(", ")}` : ""}.`,
    });
  }

  const pays = claims.filter((c) => c.kind === "deposit" || c.kind === "transparent_payment");
  const valued = (k) => pays.filter((c) => c.kind === k && c.value_zat != null);
  const dep = valued("deposit"), tp = valued("transparent_payment");
  const unvalued = pays.length - dep.length - tp.length;
  const paidZat = [...dep, ...tp].map((c) => c.value_zat);
  items.push({
    key: "Paid out",
    zat: pays.length ? (paidZat.length ? sum(paidZat) : null) : 0,
    atLeast: paidZat.length > 0 && paidZat.length < pays.length,
    sub: pays.length ? `in ${plural(pays.length, "payment")}` : "none claimed",
    value: pays.length ? `${totalText([...dep, ...tp].map((c) => c.value_zat), net)} in ${plural(pays.length, "payment")}` : "None claimed",
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
    const beacon = reportBeacon(report);
    control = {
      zat: sum(shown.map((c) => c.value_zat ?? 0)),
      sub: beacon ? `answers block ${heightText(beacon.height)}` : "answers your nonce",
      tone: "ok",
      value: amountText(sum(shown.map((c) => c.value_zat ?? 0)), net),
      detail: beacon
        ? `${spent.join(", ")}, spent in answer to the beacon of ${beaconBlockText(beacon)}${heights.length ? ` at height ${heights.join(", ")}` : ""}: no one issued the nonce; judge whether that block is recent enough.`
        : `${spent.join(", ")}, spent in answer to your nonce${heights.length ? ` at height ${heights.join(", ")}` : ""}${report.issued_at_height != null ? ` (issued at height ${report.issued_at_height})` : ""}.`,
    };
  } else {
    control = {
      value: !controls.length ? "None" : !shown.length ? "Failed" : "Not matched",
      tone: "warn",
      detail: !controls.length ? "The dossier has no control claim."
        : !shown.length ? "The control claim did not verify."
          : "A control claim verified, but not against your nonce: enter the nonce you issued.",
    };
  }
  // Whether the claims add up (spec §5.6): every payment's and the control's funds traced to an origin that names its
  // source, and nothing paid from money the dossier does not disclose.
  const gaps = explanationGaps(report, dossier);
  items.push({
    key: "Explained",
    tone: report?.all_verified && !gaps.length ? "ok" : "warn",
    sub: !report?.all_verified ? "" : gaps.length ? plural(gaps.length, "gap") : "every payment traced",
    value: !report?.all_verified ? "Not established" : gaps.length ? "No" : "Yes",
    detail: !report?.all_verified ? "Not every claim verified."
      : gaps.length ? `${cap(listJoin(gaps))}.`
        : "Every payment's and the control's funds trace back to an origin that names its source, and no transaction paid from notes the dossier does not disclose.",
  });

  items.push({ key: "Control", ...control });

  const counts = statusCounts(claims);
  const order = ["verified", "failed", "not_checked", "unproven"];
  items.push({
    key: "Claims",
    tone: counts.verified === claims.length ? "ok" : "warn",
    sub: `of ${plural(claims.length, "claim")}`,
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
  const beacon = reportBeacon(report);
  if (beacon) rows.push(["Control answers the beacon of", `${beaconBlockText(beacon)}${beacon.hash ? `, hash ${beacon.hash}` : ""}`]);
  if (meta.deposit) {
    const how = meta.deposit.state === "paid" ? (meta.deposit.claims.length ? `paid in ${listJoin(meta.deposit.claims.map((i) => claimRef(i)))}` : "paid")
      : meta.deposit.otherNetwork ? "for another network than this dossier" : "no verified payment pays it";
    rows.push(["Deposit address you assigned", `${meta.deposit.address} (${how})`]);
  }
  return rows;
}

/** The reviewer's case fields (name, case id, date), as typed; blank ones are left out. */
const caseFieldRows = (f = {}) => [["Reviewer", f.reviewer], ["Case id", f.caseId], ["Case date", f.date]].filter(([, v]) => String(v ?? "").trim());

/** The plain-text case summary a reviewer pastes into their case notes. */
export function caseSummaryText(dossier, report, meta = {}) {
  const v = caseVerdict(report, dossier, { deposit: meta.deposit, sample: Object.hasOwn(SAMPLES, meta.source ?? "") ? meta.source : null });
  const mask = (t) => maskNonces(t, meta.mask ?? []);
  const lines = [`Zeceipt case review: ${v.headline}`, mask(v.sub)];
  if (meta.deposit?.state === "unpaid") lines.push(depositLineText(meta.deposit));
  for (const [k, val] of caseFieldRows(meta.caseFields)) lines.push(`${k}: ${String(val).trim()}`);
  for (const [k, val] of caseFacts(dossier, report, meta)) lines.push(`${k}: ${val}`);
  if (meta.wasmSha256) lines.push(`Verifier: zeceipt_wasm_bg.wasm sha256 ${meta.wasmSha256}`);
  if (meta.nonce) lines.push(`Control: ${meta.nonce.text}${meta.nonce.note ? ` ${meta.nonce.note}` : ""}`);
  if (v.counts) {
    lines.push("", "Decision summary:");
    for (const d of decisionSummary(dossier, report)) lines.push(`- ${d.key}: ${d.value}. ${d.detail}`);
  }
  lines.push("", "Claims:");
  for (const r of claimRows(report, dossier, { deposit: meta.deposit, mask: meta.mask })) {
    lines.push(`${r.number}. ${r.kindLabel}, ${r.statusLabel.toLowerCase()}: ${r.summary}`, ...r.flags.map((f) => `   ${f.text}`));
  }
  if (report?.disclosed?.length) lines.push("", "The holder disclosed:", ...report.disclosed.map((d) => `- ${d}`));
  if (report?.does_not_prove?.length) lines.push("", "This does not prove:", ...report.does_not_prove.map((d) => `- ${d}`));
  return lines.join("\n");
}

/** The report without the notes' nullifiers (the dossier's nk gives them again to whoever holds the dossier). */
export function withoutNullifiers(report) {
  const notes = Object.fromEntries(Object.entries(report?.notes ?? {}).map(([id, n]) => {
    const { nullifier, ...rest } = n;
    return [id, rest];
  }));
  return { ...report, notes };
}

/** What a report downloaded with its nullifiers left out says about it (`case.nullifiers`). */
export const NULLIFIERS_HIDDEN = "left out of this file (notes.*.nullifier): checking the dossier again, with its nk, gives them; dossier_sha256 still names the dossier";

/**
 * The report as downloaded for a case file: the verifier's report, plus when, how and by whom it was checked (the
 * nodes, or the files offline; the verifier and its wasm's sha256; the nonce the reviewer entered; the deposit address
 * they assigned; their case fields). With `meta.hideNullifiers`, the notes' nullifiers are left out, and it says so.
 */
export function reportForDownload(report, meta = {}) {
  const f = meta.caseFields ?? {};
  const field = (v) => String(v ?? "").trim() || null;
  return {
    ...(meta.hideNullifiers ? withoutNullifiers(report) : report),
    case: {
      checked_at: meta.checkedAt ?? null,
      nodes: meta.nodes ?? [],
      offline_files: meta.offline ?? null,
      verifier: meta.verifier ?? null,
      verifier_wasm_sha256: meta.wasmSha256 ?? null,
      reviewer_nonce: meta.nonce ? { state: meta.nonce.state, issued: field(meta.issued), issued_at_height: report?.issued_at_height ?? null } : null,
      expected_deposit_address: meta.deposit ? { address: meta.deposit.address, paid_in_claims: meta.deposit.claims } : null,
      nullifiers: meta.hideNullifiers ? NULLIFIERS_HIDDEN : "included (notes.*.nullifier)",
      reviewer: field(f.reviewer),
      case_id: field(f.caseId),
      case_date: field(f.date),
    },
  };
}

export const reportFileName = (report) => `zeceipt-case-${String(report?.dossier_sha256 ?? "report").slice(0, 12)}.json`;
