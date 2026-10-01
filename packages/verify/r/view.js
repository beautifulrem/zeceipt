// Pure display logic for the public receipt page (r/index.html): verifier output in,
// plain strings and rows out. No DOM here; r/page.js renders these with textContent only.
import { confirmations } from "../src/index.js";

/** User copy per verifier stage (docs/product/04_ux_flows.md §4). */
export const STAGE_COPY = {
  parse: "This is not a Zeceipt receipt (or it is for a newer format).",
  tx: "The transaction data could not be read.",
  txid: "This receipt is for a different transaction than the one provided.",
  signature: "The issuer signature does not match — the receipt was altered after signing, or it was not signed by the stated key.",
  challenge: "The challenge you entered does not match the one bound into this receipt.",
  output: "The receipt points at an output that does not exist in this transaction.",
  recovery: "The disclosed key does not open this output — the receipt is not valid for this payment.",
  other: "The receipt could not be checked.",
};

/** The same stages, for a `zdp:1:` delivery proof, which has no issuer key or challenge (judge round 3, N3-1). */
export const DELIVERY_STAGE_COPY = {
  parse: "This is not a zdp:1 delivery proof (or it is for a newer version).",
  tx: "The transaction data could not be read, or is not exactly one canonical transaction.",
  txid: "This delivery proof is for a different transaction than the one provided.",
  signature: "A delivery proof carries no signature, so it cannot meet a required one.",
  challenge: "A delivery proof cannot be bound to a challenge.",
  output: "The proof points at an action that does not exist in this transaction.",
  recovery: "The proof's note is not the one this action carries: the proof is not valid for this payment.",
  other: "The delivery proof could not be checked.",
};

/** 04 §4 "pending": the node does not have the transaction (yet). */
export const NOT_FOUND_COPY = "The transaction was not found yet. It may be unconfirmed — try again later.";

const NETWORK_NAME = { main: "Zcash mainnet", test: "Zcash testnet", regtest: "local regtest chain (development only)" };

/** "zjs.zec.rocks/mainnet" from "https://zjs.zec.rocks/mainnet": the node as a person reads it. */
export function nodeHost(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return String(endpoint);
  }
}

/** The domain a `<label>@<domain>` key id claims (spec §7), for display only; the claim is checked by the issuer check. */
const claimedDomain = (keyId) => (typeof keyId === "string" && keyId.includes("@") ? keyId.slice(keyId.lastIndexOf("@") + 1) : "");
const shortKey = (hex) => (hex && hex.length > 20 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex ?? "");

/** What the link says, shown before anything is fetched. Values are plain text. */
export function summaryRows(r) {
  if (r.kind === "delivery-proof") {
    // A `zdp:1:` delivery proof (zcash-delivery-proof's format; judge round 1, D6): it names no network and has no
    // label, signature or challenge, so the rows say so rather than leave them out.
    return [
      ["Format", "zdp:1 delivery proof (the recipient's or the sender's; zcash-delivery-proof)"],
      ["Network", "not named in the proof: the page asks Zcash mainnet, then testnet"],
      ["Transaction", r.txid],
      ["Output", `${r.pool} output ${r.output_index}`],
      ["Issuer signature", "none (a delivery proof carries none)"],
      ["Challenge", "none (a delivery proof cannot be bound to one)"],
    ];
  }
  return [
    ["Network", NETWORK_NAME[r.network] ?? r.network],
    ["Transaction", r.txid],
    ["Output", `${r.pool} output ${r.output_index}`],
    ["Label", r.label ? r.label : "(none)"],
    ["Issuer signature", r.signature ? `present, key ${shortKey(r.issuer_pubkey)}${r.issuer_key_id ? ` (key id ${r.issuer_key_id})${claimedDomain(r.issuer_key_id) ? `; claims ${claimedDomain(r.issuer_key_id)}, not checked` : ""}` : ""} — checked when you verify` : "none (unsigned)"],
    ["Challenge", r.challenge ? "bound — enter the challenge you sent to the issuer" : "none (a bearer receipt: anyone holding it can verify it)"],
  ];
}

/** How the page can get the transaction for this receipt's network. A delivery proof names none (`network` null):
 * its endpoints are mainnet's then testnet's. */
export function fetchPlan(network, endpoints) {
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    return { canFetch: true, note: `The node (${endpoints.map(nodeHost).join(", then ")}), and any service behind it, learns which transaction you look up. Nothing else is sent; the page then asks the same node for its chain tip, a request that carries nothing.` };
  }
  return { canFetch: false, note: `No public node serves the ${NETWORK_NAME[network] ?? network}. Load the raw transaction from a file instead.` };
}

/**
 * Part 2 of the outcome. `source` is {kind: "node", chain, endpoint, tip} or {kind: "file"}; `tip` is the same node's
 * chain tip, null when it was not given, or undefined while the page is still asking (the verdict is shown first). Depth is counted as Zcash counts it (confirmations = tip - height + 1) and
 * read against ZIP 315's policy for funds from others (slice A2; R132).
 */
export function inclusion(source) {
  if (source.kind === "file") {
    return { state: "unknown", text: "Unknown: the transaction was loaded from a file. Check the txid on an explorer or your own node." };
  }
  if (source.kind === "sample") {
    // The paste demo's sample (review F round 5): the committed synthetic transaction, which is on no chain.
    return { state: "unknown", text: "Unknown: this is the synthetic sample, which is on no chain." };
  }
  if (source.kind === "pasted") {
    // The paste demo (review F round 4): bytes typed or pasted into the page, not fetched and not from a file.
    return { state: "unknown", text: "Unknown: the transaction bytes were supplied on this page, not fetched from a node. Check the txid on an explorer or your own node." };
  }
  const node = nodeHost(source.endpoint);
  switch (source.chain.status) {
    case "mined":
    {
      if (source.tip === undefined) {
        return { state: "mined", confirmations: null, text: `Mined at height ${source.chain.height}, according to ${node}; asking it for its chain tip…` };
      }
      const depth = confirmations(source.chain.height, source.tip);
      if (depth === null) {
        return { state: "mined", confirmations: null, text: `Mined at height ${source.chain.height}, according to ${node}; the depth is unknown (the node gave no usable chain tip). Check it on an explorer or your own node.` };
      }
      return { state: "mined", confirmations: depth, text: `Mined at height ${source.chain.height}, ${depth} confirmation${depth === 1 ? "" : "s"}, according to ${node}. ZIP 315 recommends 10 confirmations before spending funds from an untrusted sender.` };
    }
    case "mempool":
      return { state: "pending", text: `Pending: ${node} has it in the mempool; it is not mined yet. Check again later.` };
    case "fork":
      return { state: "fork", text: `Not on the main chain: ${node} reports it mined on a fork.` };
    default:
      return { state: "unknown", text: "Unknown: the node did not say where the transaction is." };
  }
}

/** Part 3 of the outcome: who signed, and what that does and does not establish. */
export function issuerLines(result) {
  if (!result.issuer_pubkey) {
    return [
      "Unsigned: the label is the sender's unauthenticated text. The payment itself is still proven by part 1.",
    ];
  }
  return [
    `Signed by key ${result.issuer_pubkey}${result.issuer_key_id ? ` (key id ${result.issuer_key_id})` : ""}; the signature covers the label.`,
    "Which organisation holds this key is not checked here (issuer binding: unknown).",
  ];
}

/** The check offered when a signed, valid receipt's key id claims a domain (spec §7): the button, and what it costs. */
export function bindingOffer(domain) {
  return {
    button: `Check with ${domain}`,
    note: `This asks ${domain} for the keys it vouches for, which tells ${domain} that one of its receipts is being checked.`,
  };
}

/** The outcome of the check, in words. It never changes whether the receipt is valid. */
export function bindingText(b) {
  switch (b?.state) {
    case "confirmed":
      return { state: "confirmed", text: `Confirmed: ${b.domain} lists this key. It vouches for the key now; this does not say when the receipt was made.` };
    case "not_listed":
      return { state: "not_listed", text: `Not listed: ${b.domain} does not list this key. The payment above is still proven; ${b.domain} just does not vouch for who signed it.` };
    default:
      return { state: "unknown", text: `Unknown: ${b?.reason ?? "the check did not complete"}. The payment above is still proven.` };
  }
}

/** Whether the receipt proves anything about who is presenting it. The verifier counts a challenge only on a signed
 * receipt (spec §6): anyone holding an output's OCK can write any challenge into an unsigned one (judge round 1, D4).
 * A signed one proves only that the holder of the signing key made it after the challenge, and anyone holding a receipt
 * for the payment can sign one with their own key; so until the key's domain confirms it (`binding`, spec §7), the line
 * says so (judge round 2, N1: a receipt re-signed with a stranger's key read as "matched"). */
export function challengeLine(result, binding) {
  if (!result.challenge_checked) return "Not bound to a signed challenge: this does not prove who is showing it to you.";
  if (binding?.state === "confirmed") return `Bound to your challenge, and it matched: the holder of the key ${binding.domain ?? "the domain"} lists made this receipt after you sent the challenge.`;
  return `Your challenge matched, but by key ${shortKey(result.issuer_pubkey)}, which no domain has confirmed here: anyone who holds a receipt for this payment can make one like this with their own key. Compare the key with the one the issuer gave you${result.issuer_key_id?.includes("@") ? ", or check its domain (part 3)" : ""}.`;
}

export function memoText(memo) {
  if (!memo) return "";
  if (memo.kind === "text") return memo.text;
  if (memo.kind === "empty") return "(empty)";
  return `bytes ${memo.hex}`;
}

/** The coin's name for an amount paid to `recipient`: TAZ on testnet and regtest (whose addresses say so: `utest…`,
 * `uregtest…`, `ztestsapling…`, `zregtestsapling…`), ZEC on mainnet. A testnet receipt showing "0.01 ZEC" misnamed
 * a coin with no value. */
export function coinUnit(recipient) {
  return /^(utest1|uregtest1|ztestsapling1|zregtestsapling1)/.test(recipient ?? "") ? "TAZ" : "ZEC";
}

/** The whole outcome as data: invalid → headline and stage copy; valid → the three parts. */
export function outcome(result, source) {
  if (!result || !result.valid) {
    const stage = result?.stage ?? "other";
    const copy = result?.kind === "delivery-proof" ? DELIVERY_STAGE_COPY : STAGE_COPY;
    return { valid: false, headline: "INVALID", stageCopy: copy[stage] ?? copy.other, error: result?.error ?? "" };
  }
  if (result.kind === "delivery-proof") {
    return {
      valid: true,
      headline: "VALID",
      payment: [
        ["Recipient", result.recipient],
        ["Value", `${result.value_zec} ${coinUnit(result.recipient)} (${result.value_zat} zat)`],
        ["Memo", memoText(result.memo)],
        ["Output", `${result.pool} output ${result.output_index} of ${result.txid}`],
      ],
      amount: { zec: result.value_zec, zat: result.value_zat, unit: coinUnit(result.recipient) },
      inclusion: inclusion(source),
      issuer: ["No issuer: a delivery proof is unsigned. It shows that this note was delivered, not who sent it or who made the proof (the recipient or the sender can)."],
      challenge: "A delivery proof cannot be bound to a challenge: this does not prove who is showing it to you.",
    };
  }
  return {
    valid: true,
    headline: "VALID",
    payment: [
      ["Recipient", result.recipient],
      ["Value", `${result.value_zec} ${coinUnit(result.recipient)} (${result.value_zat} zat)`],
      ["Memo", memoText(result.memo)],
      ["Label", result.label ? result.label : "(none)"],
      ["Output", `${result.pool} output ${result.output_index} of ${result.txid}`],
    ],
    // The value as data too (review F round 2), so the page lays it out from the numbers, not by parsing its text.
    amount: { zec: result.value_zec, zat: result.value_zat, unit: coinUnit(result.recipient) },
    inclusion: inclusion(source),
    issuer: issuerLines(result),
    challenge: challengeLine(result),
  };
}

/** An address shortened in the middle for a one-line summary ("u1792v3n…j5mtel"); the table keeps it whole. */
export function middle(text, head = 8, tail = 6) {
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** The line under the verdict (slice F2, review F rounds 1 and 7): which payment, then what a VALID means here, in
 * words, so amber is never a bare "VALID" — as Etherscan leads with a one-line action summary. Empty for INVALID,
 * whose stage copy says what failed. */
export function verdictNote(view) {
  const { lead, addr, rest } = verdictParts(view);
  return lead + addr + rest;
}

/** verdictNote in three parts, so the page can set the address in the mono face (review F round 8); joined, they are
 * verdictNote's string. */
export function verdictParts(view) {
  if (!view.valid) return { lead: "", addr: "", rest: "" };
  const row = (k) => view.payment?.find(([key]) => key === k)?.[1];
  const memo = row("Memo");
  const tail = view.inclusion.state === "mined" ? "; the node reports its transaction mined." : ". Its chain inclusion is not confirmed: see 2. Chain inclusion.";
  if (!(view.amount && row("Recipient"))) return { lead: `The payment is proven${tail}`, addr: "", rest: "" };
  return {
    lead: `${valueParts(view.amount.zec).major} ${view.amount.unit ?? "ZEC"} to `,
    addr: middle(row("Recipient")),
    rest: `${memo && memo !== "(empty)" ? `, memo ${memo},` : ""} is proven${tail}`,
  };
}

/** A ZEC amount string ("2.50000000") split for display: the digits up to the last significant one (at least one
 * after the point) and the trailing zeros, which are shown lighter, as the console does. Joined, they are the string. */
export function valueParts(zec) {
  const m = /^(\d+\.\d*?)(0*)$/.exec(zec);
  if (!m) return { major: zec, zeros: "" };
  const [, major, zeros] = m;
  return major.endsWith(".") ? { major: major + zeros.slice(0, 1), zeros: zeros.slice(1) } : { major, zeros };
}

/**
 * Where a public explorer shows a value: CipherScan (cipherscan.app, and testnet.cipherscan.app for testnet), for a
 * transaction, a transparent address or a block height. Checked by hand on 2026-10-01: /tx/<txid>, /address/<t-addr>
 * and /block/<height> answer 200 with the value for testnet values on testnet.cipherscan.app, as /tx/<txid> does for a
 * mainnet transaction on cipherscan.app. A shielded or unified address is not linked (an explorer shows nothing of
 * it), nor is anything on another network. Following a link tells the explorer which value you looked at.
 */
export const EXPLORER = { main: { name: "CipherScan", base: "https://cipherscan.app" }, test: { name: "CipherScan (testnet)", base: "https://testnet.cipherscan.app" } };
export function explorerUrl(kind, value, network) {
  const ex = EXPLORER[network];
  const v = String(value ?? "").trim();
  if (!ex || !v) return null;
  if (kind === "tx" && /^[0-9a-f]{64}$/.test(v)) return `${ex.base}/tx/${v}`;
  if (kind === "block" && /^\d+$/.test(v)) return `${ex.base}/block/${v}`;
  // A transparent address: t1/t3 on mainnet, tm/t2 on testnet (base58, 35 characters).
  const prefix = network === "main" ? /^t[13]/ : /^t[m2]/;
  if (kind === "address" && prefix.test(v) && /^[1-9A-HJ-NP-Za-km-z]{35}$/.test(v)) return `${ex.base}/address/${v}`;
  return null;
}

/** A zatoshi amount (a number or a BigInt) as its eight-decimal string: 24743750 → "0.24743750". */
export function zecString(zat) {
  const z = BigInt(zat);
  const neg = z < 0n ? "-" : "";
  const a = z < 0n ? -z : z;
  return `${neg}${a / 100_000_000n}.${String(a % 100_000_000n).padStart(8, "0")}`;
}

/** A block height with thousands separators: 4422279 → "4,422,279" (FE07). */
export const heightText = (h) => (Number.isFinite(h) ? Number(h).toLocaleString("en-US") : "");

