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

/** The dossier's control nonces. */
export const dossierNonces = (dossier) => (dossier?.claims ?? []).filter((c) => c.type === "control").map((c) => String(c.nonce ?? "").trim()).filter(Boolean);

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
 * What keeps the claims from explaining the funds (spec §5.6), as phrases: the untraced notes, and the least value
 * paid from notes the dossier does not disclose. Empty when every payment and control traces back to an origin and
 * no transaction spent undisclosed notes.
 */
export function explanationGaps(report) {
  const gaps = [];
  const u = report?.untraced ?? [];
  if (u.length) gaps.push(`${u.length === 1 ? "note" : "notes"} ${listJoin(u)} ${u.length === 1 ? "is" : "are"} not traced back to an origin (no chain of path claims leads from an origin claim to ${u.length === 1 ? "it" : "them"})`);
  if (report?.undisclosed_input_min_zat > 0) gaps.push(`at least ${amountText(report.undisclosed_input_min_zat, report.network)} came from notes the dossier does not disclose`);
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
 * `opts.sample` is true for one of this site's samples (which the verifier must read).
 */
export function caseVerdict(report, dossier = null, opts = {}) {
  if (!report || report.error || !Array.isArray(report.claims)) {
    const p = report?.error ? parseErrorText(report.error) : null;
    if (opts.sample && p && STALE_VERIFIER.test(p.raw)) {
      return { tone: "pending", headline: "Reload the page", sub: "This page's verifier is older than its sample dossier: the site was updated while the page was open, or the browser kept an old copy of the verifier. Reload the page.", raw: p.raw, counts: null, reason: "stale" };
    }
    return { tone: "bad", headline: "Not a readable dossier", sub: p ? p.text : "The verifier could not read it.", raw: p?.raw ?? null, counts: null };
  }
  const v = gradedVerdict(report, dossier);
  if (opts.deposit?.state === "paid" && v.tone !== "bad") v.sub += ` ${depositLineText(opts.deposit)}`;
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
  // Offline (transactions from files, no heights), nothing was checked against the chain, so no sentence says it was.
  const against = report.anchored === false ? "the transactions you loaded" : "the chain";
  if (counts.failed > 0) {
    const one = counts.failed === 1 ? report.claims.find((c) => c.status === "failed") : null;
    return {
      tone: "bad",
      headline: `${plural(counts.failed, "claim")} failed`,
      sub: `${counts.verified} of ${n} verified${counts.not_checked ? `, ${counts.not_checked} not checked` : ""}. A failed claim is not supported by ${against}: ${one ? `${claimRef(one.index, one.kind)}: ${one.summary}` : "its row below says why."}`,
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
  const breakdown = kindBreakdown(report.claims);
  const h0 = report.issued_at_height;
  const hasControl = report.claims.some((c) => c.kind === "control") || (dossier?.claims ?? []).some((c) => c.type === "control");
  const assurance = assuranceOf(report);
  const gaps = explanationGaps(report);
  if (assurance === "verified_with_control") {
    return {
      tone: "ok",
      headline: "Verified, with control",
      sub: `${all} against the chain (${breakdown}), and the control claim answers the nonce you issued${h0 != null ? `, after height ${h0}` : ""}: the holder could spend these funds after your challenge.`,
      counts,
    };
  }
  if (assurance === "consistent_offline") {
    const control = report.controlled
      ? " The control claim answers the nonce you issued, but without heights nothing shows when it was mined."
      : hasControl ? " The control claim is not matched to your nonce." : " The dossier has no control claim.";
    return {
      tone: "partial",
      headline: "Consistent with the files you loaded — not checked against the chain",
      sub: `${n === 1 ? "The claim is consistent" : `All ${n} claims are consistent`} with the transaction files you loaded (${breakdown}), but no node was asked, so whether these transactions are in the chain, and at which heights, was not checked: a holder can send fabricated files. Load only files you fetched from a node yourself, or check online.${gaps.length ? ` Also, the claims do not explain all of the funds: ${listJoin(gaps)}.` : ""}${control}`,
      reason: "offline",
      counts,
    };
  }
  if (assurance === "verified_partly_explained") {
    const control = report.controlled
      ? ` The control claim answers the nonce you issued${h0 != null ? `, after height ${h0}` : ""}.`
      : hasControl ? " The control claim is not matched to your nonce: enter the nonce you issued under “Challenge the holder”." : " The dossier has no control claim.";
    return {
      tone: "partial",
      headline: "Claims verified — funds not fully explained",
      sub: `${all} against the chain (${breakdown}), but they do not explain all of the funds: ${listJoin(gaps) || "the report says so"}. Ask the holder for the missing history (the transactions that lead those funds back to an origin) before you rely on it.${control}`,
      reason: "partly-explained",
      counts,
    };
  }
  return {
    tone: "partial",
    headline: "Claims verified — control not shown",
    sub: hasControl
      ? `${all} against the chain (${breakdown}), but the control claim is not matched to your nonce: no expected nonce was given. Enter the nonce you issued under “Challenge the holder”.`
      : `${all} against the chain (${breakdown}), but the dossier has no control claim: nothing shows the holder can spend these funds now. Send them a challenge (below).`,
    reason: hasControl ? "no-nonce" : "no-control",
    counts,
  };
}

/**
 * What a claim's row flags beyond its status, as `{ tone, text }` (tone "warn" or "ok"): funding notes not traced to an
 * origin, value paid from undisclosed notes (spec §5.6), and a payment to the deposit address the reviewer assigned.
 */
export function claimFlags(claim, untraced = [], deposit = null, network) {
  const flags = [];
  if (untraced.length) flags.push({ tone: "warn", text: `Not traced to an origin: ${listJoin(untraced)} (no chain of path claims leads ${untraced.length === 1 ? "it" : "them"} back to an origin claim).` });
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
    flags: claimFlags(c, untraced[c.index] ?? [], opts.deposit ?? null, report?.network),
  }));
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
  const deposit = extras.deposit ?? null;
  const mask = (t) => (t == null ? t : maskNonces(t, extras.mask ?? []));
  const steps = new Map();
  const note = (id) => ({ id, value_zat: notes[id]?.value_zat, value: amountText(notes[id]?.value_zat, network), txid: notes[id]?.txid, height: notes[id]?.height ?? null, memo: notes[id]?.memo, error: notes[id]?.error });
  // A note a payment or the control spent, which no chain of path claims leads back to an origin (spec §5.6).
  const spentNote = (id) => ({ ...note(id), untraced: untraced.has(id) });
  const step = (txid) => {
    const key = (txid ?? "").toLowerCase();
    if (!steps.has(key)) steps.set(key, { txid: key, height: heights[key] ?? null, stages: new Set(), spent: [], created: [], payments: [], edges: [], funding: [], claims: [], undisclosed_zat: 0 });
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
      s.funding.push({ note: c.note, text: fundingText(r.funding, network, r.details ?? []), funding: r.funding ?? null });
      s.edges.push({ index: i, kind: "origin", status, label: `Funds reach the holder as ${c.note}` });
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
      s.payments.push({ id: c.receipt, value_zat: value ?? null, value: amountText(value, network), recipient: p.recipient ?? null, memo: p.memo ?? null, transparent: false });
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
  // be able to copy it from this page into "Nonce you issued".
  const masked = listJoin(nonces.map((n) => `a nonce beginning ${maskNonce(n)}`));
  const mine = String(issued ?? "").trim();
  if (!mine) {
    return { state: "not-generated", text: `The control claim answers ${masked}. Enter the nonce you issued under “Challenge the holder” (paste it from your case record, not from this page), and the page checks the claim against it.` };
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

/**
 * A transparent address as the reviewer typed it: `{ address, network, kind, hash }` (kind p2pkh, p2sh or tex; hash:
 * the 20-byte key or script hash, hex), `{ error }` when it is not one, or null when blank. A TEX address (ZIP 320,
 * the form some exchanges assign) carries the same key hash as the P2PKH address a payment to it shows on chain.
 */
export function depositAddressInput(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const bad = { error: "This is not a transparent address (t1…, t3… on mainnet, tm… on testnet) or a TEX address (tex1…): it is left out of the check." };
  if (/^tex/i.test(s)) {
    const b = bech32m(s);
    const network = b && TEX_HRP[b.hrp];
    return network && b.data.length === 20 ? { address: s, network, kind: "tex", hash: hexOf(b.data) } : bad;
  }
  const b = /^t[1-9A-HJ-NP-Za-km-z]{33,35}$/.test(s) ? base58(s) : null;
  const known = b?.length === 26 ? T_PREFIX[hexOf(b.slice(0, 2))] : null;
  return known ? { address: s, network: known[0], kind: known[1], hash: hexOf(b.slice(2, 22)) } : bad;
}

/** Whether a payment to `paidTo` (the core's transparent address, read from the output's script) pays `assigned`. */
export function paysAddress(paidTo, assigned) {
  if (!paidTo || !assigned?.address) return false;
  if (assigned.kind !== "tex") return paidTo === assigned.address;
  const p = depositAddressInput(paidTo);
  return Boolean(p && !p.error && p.kind === "p2pkh" && p.network === assigned.network && p.hash === assigned.hash);
}

/**
 * The deposit address check: `{ state: "paid", claims: [index] }` when verified transparent payments pay the address
 * the reviewer assigned, `{ state: "unpaid" }` when none does, null when no address was given (or it is not one).
 */
export function depositCheck(report, assigned) {
  if (!assigned || assigned.error) return null;
  const claims = (report?.claims ?? []).filter((c) => c.kind === "transparent_payment" && c.status === "verified" && paysAddress(c.paid_to, assigned)).map((c) => c.index);
  return claims.length ? { state: "paid", claims, address: assigned.address } : { state: "unpaid", claims: [], address: assigned.address };
}

/** The verdict's line on the assigned deposit address (the banner shows it green when paid, amber when not). */
export function depositLineText(check) {
  if (!check) return "";
  if (check.state === "paid") {
    return `${cap(listJoin(check.claims.map((i) => claimRef(i, "transparent_payment"))))} ${check.claims.length === 1 ? "pays" : "pay"} the deposit address you assigned (${check.address}): the disclosed funds reached the account you gave this customer.`;
  }
  return `No verified payment in this dossier pays the deposit address you assigned (${check.address}); check that it is the address you gave this customer. A control answer can be relayed: someone who does not hold these funds can pass your nonce to whoever does and show you that party's dossier (spec §7.2). A payment to the deposit address you assigned to this customer is what ties the funds to this customer.`;
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
    return { id, status: c.status, zat: notes[id]?.value_zat ?? null, kind, change: funderChange(c.details ?? []) };
  });
  if (origins.length) {
    const words = { shielded: "from an undisclosed shielded sender", transparent: "from transparent inputs", returned: "returned from the holder's own transparent payment", disclosed: "from this dossier's notes", unknown: "not established" };
    const parts = Object.keys(words).map((k) => [k, origins.filter((o) => o.kind === k)]).filter(([, os]) => os.length)
      .map(([k, os]) => `${k === "unknown" ? "" : `${totalText(os.map((o) => o.zat), net)} `}${words[k]}`);
    const change = origins.flatMap((o) => o.change);
    const weak = origins.filter((o) => o.status !== "verified");
    items.push({
      key: "Arrived at origins",
      value: `${totalText(origins.map((o) => o.zat), net)} in ${plural(origins.length, "note")}`,
      detail: `${listJoin(parts)}${change.length ? `; of the inputs, ${listJoin(change.map((x) => `${amountText(x.value_zat, net)} went back to ${x.address}`))} as change to the funder` : ""}${weak.length ? `; not verified: ${weak.map((o) => `${o.id} (${(STATUS_LABEL[o.status] ?? o.status).toLowerCase()})`).join(", ")}` : ""}.`,
    });
  }

  const pays = claims.filter((c) => c.kind === "deposit" || c.kind === "transparent_payment");
  const valued = (k) => pays.filter((c) => c.kind === k && c.value_zat != null);
  const dep = valued("deposit"), tp = valued("transparent_payment");
  const unvalued = pays.length - dep.length - tp.length;
  items.push({
    key: "Paid out",
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

  // Whether the claims add up (spec §5.6): every payment's and the control's funds traced to an origin, and nothing
  // paid from notes the dossier does not disclose.
  const gaps = explanationGaps(report);
  items.push({
    key: "Explained",
    value: !report?.all_verified ? "Not established" : gaps.length ? "No" : "Yes",
    detail: !report?.all_verified ? "Not every claim verified."
      : gaps.length ? `${cap(listJoin(gaps))}.`
        : "Every payment's and the control's funds trace back to an origin, and no transaction paid from notes the dossier does not disclose.",
  });

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
  if (meta.deposit) rows.push(["Deposit address you assigned", `${meta.deposit.address} (${meta.deposit.state === "paid" ? `paid in ${listJoin(meta.deposit.claims.map((i) => claimRef(i)))}` : "no verified payment pays it"})`]);
  return rows;
}

/** The reviewer's case fields (name, case id, date), as typed; blank ones are left out. */
const caseFieldRows = (f = {}) => [["Reviewer", f.reviewer], ["Case id", f.caseId], ["Case date", f.date]].filter(([, v]) => String(v ?? "").trim());

/** The plain-text case summary a reviewer pastes into their case notes. */
export function caseSummaryText(dossier, report, meta = {}) {
  const v = caseVerdict(report, dossier, { deposit: meta.deposit });
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
