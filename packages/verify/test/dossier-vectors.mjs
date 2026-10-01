// The conformance vectors of spec/dossier-v1.md §11 (spec/test-vectors/dossier-v1.json), run through the committed WASM
// with checkDossier, as crates/zeceipt-core/tests/dossier_vectors.rs runs them natively: the browser and the CLI must
// give every case the same outcome.
// Usage: node packages/verify/test/dossier-vectors.mjs (CI runs it after dossier-view.mjs).
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const repo = path.join(root, "..", "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

const { initVerifier, checkDossier, dossierTxids, dossierPrevoutTxids } = await import("../src/index.js");
await initVerifier(fs.readFileSync(path.join(root, "pkg/zeceipt_wasm_bg.wasm")));

const vectors = JSON.parse(read("spec/test-vectors/dossier-v1.json"));

// RFC 6902 add, replace and remove on JSON pointers without escapes ("-" appends to an array).
function apply(doc, patch) {
  for (const op of patch) {
    const keys = op.path.slice(1).split("/");
    const last = keys.pop();
    let at = doc;
    for (const k of keys) at = at[Array.isArray(at) ? Number(k) : k];
    if (op.op === "remove") Array.isArray(at) ? at.splice(Number(last), 1) : delete at[last];
    else if (op.op === "add" && Array.isArray(at)) last === "-" ? at.push(op.value) : at.splice(Number(last), 0, op.value);
    else at[Array.isArray(at) ? Number(last) : last] = op.value;
  }
  return doc;
}

const file = (t) => {
  try {
    return read(`fixtures/testnet/${t}.hex`).trim();
  } catch {
    return null;
  }
};

// What the case supplies: the transactions the claims name, then the origins' previous transactions, as the CLI fetches.
function supply(text, txs = {}) {
  const got = {};
  for (const round of [0, 1]) {
    const ids = round === 0 ? dossierTxids(text) : dossierPrevoutTxids(text, got);
    for (const t of ids) {
      if (txs.omit?.includes(t)) continue;
      const hex = txs.hex?.[t] ?? file(t);
      if (hex === null) continue;
      const mempool = txs.mempool === "all" || (Array.isArray(txs.mempool) && txs.mempool.includes(t));
      got[t] = { hex, height: !mempool && txs.heights === true ? vectors.heights[t] ?? null : null, mempool };
    }
  }
  return got;
}

function outcome(r) {
  const exit = r.all_verified ? (["consistent_offline", "verified_partly_explained"].includes(r.assurance) ? 4 : 0) : r.problems?.length || r.claims.some((c) => c.status === "failed" || c.status === "unproven") ? 1 : 2;
  const v = { exit, all_verified: r.all_verified, assurance: r.assurance, nk_proven: r.nk_proven, controlled: r.controlled, statuses: r.claims.map((c) => c.status) };
  v.anchored = r.anchored;
  if (r.untraced?.length) v.untraced = r.untraced;
  if (r.undisclosed_input_min_zat > 0) v.undisclosed_input_min_zat = r.undisclosed_input_min_zat;
  if (r.unexplained_origins?.length) v.unexplained_origins = r.unexplained_origins;
  if (r.beacon_height != null) v.beacon_height = r.beacon_height;
  if (r.deposit_address_paid != null) v.deposit_address_paid = r.deposit_address_paid;
  if (r.problems?.length) v.problems = r.problems;
  const not = r.claims.filter((c) => c.status !== "verified").map(({ index, kind, status, summary }) => ({ index, kind, status, summary }));
  if (not.length) v.not_verified = not;
  return v;
}

let failures = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) console.log("ok  ", name);
  else {
    failures++;
    console.error("FAIL", name, "\n  expected", JSON.stringify(want), "\n  got     ", JSON.stringify(got));
  }
};
const base = (c) => JSON.parse(read(vectors.dossiers[c.dossier ?? "base"]));

for (const c of vectors.cases) {
  const text = JSON.stringify(apply(base(c), c.patch), null, 2);
  const r = await checkDossier(text, { txs: supply(text, c.txs), expectNonce: c.expect_nonce ?? "", issuedAtHeight: c.issued_at_height ?? null, expectDepositAddress: c.expect_deposit_address ?? "", beacons: c.beacons ?? {} });
  check(c.name, outcome(r), c.expect);
}
for (const c of vectors.parse_cases) {
  const r = await checkDossier(JSON.stringify(apply(base(c), c.patch), null, 2), { txs: {} });
  const got = r.stage === "parse" ? { exit: 1, stage: "parse", error: r.error.replace(/ at line \d+ column \d+$/, "") } : { exit: 0, stage: "none" };
  check(`parse: ${c.name}`, got, c.expect);
}

console.log(`\n${vectors.cases.length + vectors.parse_cases.length - failures} of ${vectors.cases.length + vectors.parse_cases.length} vectors hold`);
process.exit(failures ? 1 : 0);
