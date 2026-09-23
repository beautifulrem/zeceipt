// Headless regression check for the committed WASM package.
// Fails if the committed verifier no longer agrees with the committed fixtures
// (e.g. the canonical signing bytes changed but pkg/ was not rebuilt).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import init, { verify_receipt, check_signature, parse_receipt, version } from "../pkg/zeceipt_wasm.js";

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
check("vector file declares networks and pools", Array.isArray(vectors.networks) && Array.isArray(vectors.pools) && vectors.networks.length > 0 && vectors.pools.length > 0 && new Set(vectors.networks).size === vectors.networks.length && new Set(vectors.pools).size === vectors.pools.length);
check("vectors cover every declared network x pool", vectors.networks.every(n => vectors.pools.every(p => vectors.vectors.some(v => v.receipt.network === n && v.receipt.pool === p))));

// Shareable links (spec §2): the committed build parses the fragment form issuers emit and the
// v0 path form, from the vector file, to the named vector's signed receipt.
const forms = vectors.url_forms;
const named = vectors.vectors.find((v) => v.name === forms.vector);
const sorted = (o) => JSON.stringify(o, Object.keys(o).sort()); // the vector file's keys are sorted
check("url_forms fragment link has the payload after /r#", typeof forms.fragment === "string" && forms.fragment.startsWith(forms.host + "/r#"), forms.fragment);
for (const [kind, link] of [["fragment", forms.fragment], ["path", forms.path], ["location.hash", forms.fragment.slice(forms.fragment.indexOf("#"))]]) {
  let parsed;
  try { parsed = parse_receipt(link); } catch (e) { parsed = { error: String(e) }; }
  check(`${kind} link parses to the vector`, sorted(parsed) === sorted(named.signed_receipt), JSON.stringify(parsed));
}
let emptyRejected = false;
try { parse_receipt(forms.host + "/r#"); } catch { emptyRejected = true; }
check("a link with an empty fragment and no path payload is rejected", emptyRejected);

// fetchRawTx over hand-built gRPC-web responses (no network): lightwalletd's height sentinels
// (walletrpc/service.proto: 0 or absent = mempool, 0xffffffffffffffff = fork, else mined),
// failover, the regtest refusal, and what the request carries (the txid filter only).
const { fetchRawTx, chainStatus } = await import("../src/index.js");
const varint = (n) => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const frame = (flag, bytes) => { const f = new Uint8Array(5 + bytes.length); f[0] = flag; new DataView(f.buffer).setUint32(1, bytes.length, false); f.set(bytes, 5); return f; };
const rawTxMessage = (dataHex, height) => {
  const data = Buffer.from(dataHex, "hex");
  const msg = [0x0a, ...varint(data.length), ...data];
  if (height !== undefined) msg.push(0x10, ...varint(height));
  return new Uint8Array(msg);
};
const grpcBody = (message, status = 0, text = "") => {
  const trailer = new TextEncoder().encode(`grpc-status:${status}\r\ngrpc-message:${text}\r\n`);
  const parts = [...(message ? [frame(0, message)] : []), frame(0x80, trailer)];
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
};
const TXID = "4f3cc1aea0e589bd77865d33a2476963ff94909a3f1bdc8cb9bb380360e91b7f";
const seen = [];
const withFetch = async (responder, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return responder(url, init); };
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const ok200 = (body) => new Response(body, { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
const fetched = async (height) => withFetch(() => ok200(grpcBody(rawTxMessage(rawTx, height))), () => fetchRawTx(TXID, "main", ["https://node.test"]));
const view = (r) => JSON.stringify({ chain: r.chain, height: r.height });
const rejects = async (p) => { try { await p; return null; } catch (e) { return String(e); } };

const mined = await fetched(3491284n);
check("fetch: mined height is reported as mined", mined.chain?.status === "mined" && mined.chain?.height === 3491284 && mined.height === 3491284, view(mined));
check("fetch: the transaction bytes come back as hex", mined.hex === rawTx.toLowerCase() && mined.endpoint === "https://node.test");
const absent = await fetched(undefined);
check("fetch: an absent height is the mempool (pending), height null", absent.chain?.status === "mempool" && absent.height === null, view(absent));
const zero = await fetched(0n);
check("fetch: height 0 is the mempool (pending), height null", zero.chain?.status === "mempool" && zero.height === null, view(zero));
const fork = await fetched(0xffffffffffffffffn);
check("fetch: height 0xffffffffffffffff is a fork, not a height", fork.chain?.status === "fork" && fork.height === null, view(fork));
check("chainStatus maps the three cases", typeof chainStatus === "function" && chainStatus(7n).status === "mined" && chainStatus(null).status === "mempool" && chainStatus(0xffffffffffffffffn).status === "fork");
const notFound = await rejects(withFetch(() => ok200(grpcBody(rawTxMessage("", undefined))), () => fetchRawTx(TXID, "main", ["https://node.test"])));
check("fetch: empty transaction data is 'transaction not found'", /transaction [0-9a-f]{64} not found/.test(notFound ?? ""), notFound);
const trailer = await rejects(withFetch(() => ok200(grpcBody(null, 13, "internal error")), () => fetchRawTx(TXID, "main", ["https://node.test"])));
check("fetch: a non-zero grpc-status trailer is an error", /grpc trailer/.test(trailer ?? ""), trailer);
// "Unknown txid", as zeceipt-lwd classifies it: code 5, a "not found"/"no such" message, or empty data.
const code5 = await rejects(withFetch(() => ok200(grpcBody(null, 5)), () => fetchRawTx(TXID, "main", ["https://node.test"])));
check("fetch: grpc-status 5 in the trailer is 'not found'", /transaction [0-9a-f]{64} not found/.test(code5 ?? ""), code5);
const noSuch = await rejects(withFetch(() => new Response("", { status: 200, headers: { "grpc-status": "2", "grpc-message": "No such mempool or blockchain transaction" } }), () => fetchRawTx(TXID, "main", ["https://node.test"])));
check("fetch: a trailers-only 'No such … transaction' answer is 'not found'", /not found/.test(noSuch ?? ""), noSuch);
const otherHeaderErr = await rejects(withFetch(() => new Response("", { status: 200, headers: { "grpc-status": "14", "grpc-message": "unavailable" } }), () => fetchRawTx(TXID, "main", ["https://node.test"])));
check("fetch: another trailers-only status stays a transport error", /grpc-status 14/.test(otherHeaderErr ?? ""), otherHeaderErr);
const preferMissing = await rejects(withFetch((url) => url.startsWith("https://a.test") ? ok200(grpcBody(rawTxMessage("", undefined))) : Promise.reject(new TypeError("Failed to fetch")), () => fetchRawTx(TXID, "main", ["https://a.test", "https://b.test"])));
check("fetch: 'not found' from one node wins over another node being down", /not found/.test(preferMissing ?? ""), preferMissing);
seen.length = 0;
const failover = await withFetch((url) => url.startsWith("https://down.test") ? new Response("", { status: 503 }) : ok200(grpcBody(rawTxMessage(rawTx, 12n))), () => fetchRawTx(TXID, "main", ["https://down.test", "https://up.test"]));
check("fetch: fails over to the next endpoint", failover.endpoint === "https://up.test" && seen.length === 2, JSON.stringify(seen.map((x) => x.url)));
const req = seen[1];
const body = Buffer.from(req.init.body);
check("fetch: the request is GetTransaction carrying only the txid filter", req.url === "https://up.test/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction" && body.length === 5 + 2 + 32 && body.subarray(7).equals(Buffer.from(TXID, "hex").reverse()), req.url);
const regtestErr = await rejects(fetchRawTx(TXID, "regtest"));
check("fetch: regtest without endpoints is refused clearly", /no public gRPC-web endpoint for regtest; pass endpoints or load the raw transaction from a file/.test(regtestErr ?? ""), regtestErr);
const regtestOk = await withFetch(() => ok200(grpcBody(rawTxMessage(rawTx, 2875n))), () => fetchRawTx(TXID, "regtest", ["http://127.0.0.1:9"]));
check("fetch: regtest with endpoints passed works", regtestOk.chain?.status === "mined" && regtestOk.chain?.height === 2875);

// The typings follow the format: every network union in index.d.ts equals the vector file's networks.
const dts = fs.readFileSync(path.join(here, "../src/index.d.ts"), "utf8");
const union = /export type Network = ([^;]+);/.exec(dts)?.[1].split("|").map((x) => x.trim().replace(/"/g, "")) ?? [];
check("index.d.ts Network matches the format's networks", JSON.stringify([...union].sort()) === JSON.stringify([...vectors.networks].sort()), union.join(","));
check("index.d.ts types every network with Network (no stale literal unions)", !/"main" \| "test"(?! \| "regtest")/.test(dts.replace(/export type Network = [^;]+;/, "")), "a network union outside Network");

// NFR-7: the demo copy must always show what a result proves and does not prove, with text labels (not colour only).
const demoHtml = fs.readFileSync(path.join(here, "../demo/index.html"), "utf8");
check("demo page states what a valid result proves", /What a valid result proves/i.test(demoHtml));
check("demo page states what it does not prove", /What it does not prove/i.test(demoHtml));
check("demo page labels outcomes with text (VALID/INVALID)", /VALID/.test(demoHtml) && /INVALID/.test(demoHtml));

// The public receipt page (r/, slice F2b): its view logic, its copy, and its CSP.
const pageView = await import("../r/view.js");
const { GRPC_WEB_ENDPOINTS } = await import("../src/index.js");
const stages = ["parse", "tx", "txid", "signature", "challenge", "output", "recovery", "other"];
check("receipt page: every verifier stage has user copy", stages.every((st) => typeof pageView.STAGE_COPY[st] === "string" && pageView.STAGE_COPY[st].length > 10));
const bad = pageView.outcome({ valid: false, stage: "recovery", error: "x" }, null);
check("receipt page: INVALID carries the stage copy and the verifier's message", bad.headline === "INVALID" && bad.stageCopy === pageView.STAGE_COPY.recovery && bad.error === "x");
check("receipt page: an unknown stage falls back to 'other'", pageView.outcome({ valid: false, stage: "new-stage" }, null).stageCopy === pageView.STAGE_COPY.other);
const good = { valid: true, txid: "ab", pool: "ironwood", output_index: 1, recipient: "u1x", value_zat: 250000000, value_zec: "2.50000000", memo: { kind: "text", text: "m" }, label: "L", issuer_pubkey: "e".repeat(64), issuer_key_id: "k1", challenge_checked: false };
const node = (chain) => ({ kind: "node", chain, endpoint: "https://zjs.zec.rocks/mainnet" });
check("receipt page: mined inclusion names the node and disclaims depth", /^Mined at height 12, according to zjs\.zec\.rocks\/mainnet\. This page does not count confirmations/.test(pageView.outcome(good, node({ status: "mined", height: 12 })).inclusion.text));
check("receipt page: mempool is pending, fork is not the main chain, a file is unknown",
  pageView.inclusion(node({ status: "mempool" })).state === "pending" && pageView.inclusion(node({ status: "fork" })).state === "fork" && pageView.inclusion({ kind: "file" }).state === "unknown");
check("receipt page: signed issuer says binding unknown; unsigned says the label is unauthenticated",
  pageView.issuerLines(good).join(" ").includes("issuer binding: unknown") && /^Unsigned: the label is the sender's unauthenticated text/.test(pageView.issuerLines({ ...good, issuer_pubkey: undefined })[0]));
check("receipt page: challenge line for bound and bearer receipts", /matched/.test(pageView.challengeLine({ challenge_checked: true })) && /does not prove who is showing it/.test(pageView.challengeLine({ challenge_checked: false })));
check("receipt page: memo text for text, empty and bytes", pageView.memoText({ kind: "text", text: "a" }) === "a" && pageView.memoText({ kind: "empty" }) === "(empty)" && pageView.memoText({ kind: "bytes", hex: "00ff" }) === "bytes 00ff");
check("receipt page: fetch plan names the nodes, and explains regtest",
  /zjs\.zec\.rocks\/mainnet, then zcash-mainnet\.chainsafe\.dev/.test(pageView.fetchPlan("main", GRPC_WEB_ENDPOINTS.main).note) && pageView.fetchPlan("regtest", undefined).canFetch === false);
const pageHtml = fs.readFileSync(path.join(here, "../r/index.html"), "utf8");
check("receipt page states what a valid result proves, and what it does not", /What a valid result proves/.test(pageHtml) && /What it does not prove/.test(pageHtml));
check("receipt page has no inline script or style (CSP allows 'self' only)", !/<script(?![^>]*\bsrc=)[^>]*>/i.test(pageHtml) && !/<style|\sstyle=/i.test(pageHtml));
check("receipt page sends no Referer", /<meta name="referrer" content="no-referrer">/.test(pageHtml));
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(pageHtml)?.[1] ?? "";
const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? "").split(/\s+/);
const origins = [...new Set(Object.values(GRPC_WEB_ENDPOINTS).flat().map((u) => new URL(u).origin))];
check("receipt page CSP connect-src covers every public gRPC-web endpoint", origins.every((o) => connect.includes(o)), `missing: ${origins.filter((o) => !connect.includes(o)).join(" ")}`);
check("receipt page CSP is default-deny with WebAssembly allowed", /default-src 'none'/.test(csp) && /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && /form-action 'none'/.test(csp) && /base-uri 'none'/.test(csp));
const pageJs = fs.readFileSync(path.join(here, "../r/page.js"), "utf8");
check("receipt page writes the DOM with textContent only (no innerHTML/outerHTML/insertAdjacentHTML)", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(pageJs));
check("receipt page stores nothing", !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(pageJs));

console.log(version(), failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
