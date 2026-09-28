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

const shortKey = (hex) => (hex && hex.length > 20 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex ?? "");

/** What the link says, shown before anything is fetched. Values are plain text. */
export function summaryRows(r) {
  return [
    ["Network", NETWORK_NAME[r.network] ?? r.network],
    ["Transaction", r.txid],
    ["Output", `${r.pool} output ${r.output_index}`],
    ["Label", r.label ? r.label : "(none)"],
    ["Issuer signature", r.signature ? `present, key ${shortKey(r.issuer_pubkey)}${r.issuer_key_id ? ` (key id ${r.issuer_key_id})` : ""} — checked when you verify` : "none (unsigned)"],
    ["Challenge", r.challenge ? "bound — enter the challenge you sent to the issuer" : "none (a bearer receipt: anyone holding it can verify it)"],
  ];
}

/** How the page can get the transaction for this receipt's network. */
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

/** Whether the receipt proves anything about who is presenting it. */
export function challengeLine(result) {
  return result.challenge_checked
    ? "Bound to your challenge, and it matched: the issuer made this receipt for you."
    : "Not bound to a challenge: this does not prove who is showing it to you.";
}

export function memoText(memo) {
  if (!memo) return "";
  if (memo.kind === "text") return memo.text;
  if (memo.kind === "empty") return "(empty)";
  return `bytes ${memo.hex}`;
}

/** The whole outcome as data: invalid → headline and stage copy; valid → the three parts. */
export function outcome(result, source) {
  if (!result || !result.valid) {
    const stage = result?.stage ?? "other";
    return { valid: false, headline: "INVALID", stageCopy: STAGE_COPY[stage] ?? STAGE_COPY.other, error: result?.error ?? "" };
  }
  return {
    valid: true,
    headline: "VALID",
    payment: [
      ["Recipient", result.recipient],
      ["Value", `${result.value_zec} ZEC (${result.value_zat} zat)`],
      ["Memo", memoText(result.memo)],
      ["Label", result.label ? result.label : "(none)"],
      ["Output", `${result.pool} output ${result.output_index} of ${result.txid}`],
    ],
    inclusion: inclusion(source),
    issuer: issuerLines(result),
    challenge: challengeLine(result),
  };
}
