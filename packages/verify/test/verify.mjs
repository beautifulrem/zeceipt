// Headless regression check for the committed WASM package.
// Fails if the committed verifier no longer agrees with the committed fixtures
// (e.g. the canonical signing bytes changed but pkg/ was not rebuilt).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import init, { verify_receipt, check_signature, version } from "../pkg/zeceipt_wasm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasm = fs.readFileSync(path.join(here, "../pkg/zeceipt_wasm_bg.wasm"));
await init({ module_or_path: wasm });

const receipt = fs.readFileSync(path.join(here, "../demo/fixtures/synthetic-receipt.json"), "utf8");
const rawTx = fs.readFileSync(path.join(here, "../demo/fixtures/synthetic-ironwood.hex"), "utf8").trim();

let failures = 0;
const check = (name, cond, detail) => { if (!cond) { failures++; console.error("FAIL", name, detail ?? ""); } else console.log("ok  ", name); };

const ok = verify_receipt(receipt, rawTx, "auditor-nonce-7", true);
check("valid receipt verifies", ok.valid === true, JSON.stringify(ok));
check("value is 2.5 ZEC", ok.value_zat === 250000000, ok.value_zat);
check("recipient is a mainnet UA", typeof ok.recipient === "string" && ok.recipient.startsWith("u1"), ok.recipient);
check("memo text", ok.memo && ok.memo.text === "INV-2026-0142", JSON.stringify(ok.memo));
check("challenge bound", ok.challenge_checked === true);

const r = JSON.parse(receipt);
const flip = (mut) => { const c = JSON.parse(JSON.stringify(r)); mut(c); return verify_receipt(JSON.stringify(c), rawTx, "auditor-nonce-7", true); };
check("network flip -> signature", flip((c) => { c.network = "test"; }).stage === "signature");
check("pool flip -> signature", flip((c) => { c.pool = "orchard"; }).stage === "signature");
check("key id flip -> signature", flip((c) => { c.issuer_key_id = "x"; }).stage === "signature");
check("label flip -> signature", flip((c) => { c.label += "!"; }).stage === "signature");
check("wrong challenge -> challenge", verify_receipt(receipt, rawTx, "nope", true).stage === "challenge");
const unsignedTamper = (() => { const c = JSON.parse(receipt); delete c.signature; delete c.issuer_pubkey; c.ock = c.ock.slice(0, -1) + (c.ock.endsWith("A") ? "B" : "A"); return verify_receipt(JSON.stringify(c), rawTx, "auditor-nonce-7", false); })();
check("tampered ock (unsigned) -> recovery", unsignedTamper.stage === "recovery", JSON.stringify(unsignedTamper));
check("wrong tx -> txid", verify_receipt(receipt, fs.readFileSync(path.join(here, "../../../fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex"), "utf8").trim(), "auditor-nonce-7", true).stage === "txid");

// Format-derived coverage: every committed vector (all Network x Pool variants) must parse
// and its signed form must verify exactly as the vector says, so a variant added to the
// Rust enums without regenerating vectors + rebuilding pkg/ fails here.
const vectors = JSON.parse(fs.readFileSync(path.join(here, "../../../spec/test-vectors/receipt-v0.json"), "utf8"));
for (const v of vectors.vectors) {
  const sig = check_signature(JSON.stringify(v.signed_receipt));
  check(`vector ${v.name} signature ${v.verifies ? "valid" : "invalid"}`, sig.signed === true && sig.valid === v.verifies, JSON.stringify(sig));
  // Every vector must at least parse in the committed build (enum coverage).
  const parsed = verify_receipt(JSON.stringify(v.receipt), rawTx, "", false);
  check(`vector ${v.name} parses in committed pkg`, parsed.stage !== "parse", JSON.stringify(parsed));
}
// The grid comes from the vector file (emitted from Network::ALL / Pool::ALL in Rust), not from a literal here.
check("vector file declares networks and pools", Array.isArray(vectors.networks) && Array.isArray(vectors.pools) && vectors.networks.length >= 3 && vectors.pools.length >= 3);
check("vectors cover every declared network x pool", vectors.networks.every(n => vectors.pools.every(p => vectors.vectors.some(v => v.receipt.network === n && v.receipt.pool === p))));

console.log(version(), failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
