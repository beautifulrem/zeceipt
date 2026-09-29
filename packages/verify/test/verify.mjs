// Headless regression check for the committed WASM package.
// Fails if the committed verifier no longer agrees with the committed fixtures
// (e.g. the canonical signing bytes changed but pkg/ was not rebuilt).
// ZECEIPT_PKG_DIR tests another build instead, such as CI's Linux rebuild (slice X3b).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const committedPkg = path.join(here, "../pkg");
const pkgDir = path.resolve(process.env.ZECEIPT_PKG_DIR ?? committedPkg);
// Another build's wasm runs behind the committed JS wrapper below, which is sound only if its glue is the committed
// glue: check that here rather than rely on build_wasm.sh --compare having run first (review X3b).
if (pkgDir !== path.resolve(committedPkg)) {
  for (const f of ["package.json", "zeceipt_wasm.js", "zeceipt_wasm.d.ts", "zeceipt_wasm_bg.wasm.d.ts"]) {
    if (!fs.existsSync(path.join(pkgDir, f))) {
      console.error(`FAIL ${pkgDir}/${f} is missing: the wasm-bindgen glue must be identical`);
      process.exit(1);
    }
    if (!fs.readFileSync(path.join(pkgDir, f)).equals(fs.readFileSync(path.join(committedPkg, f)))) {
      console.error(`FAIL ${pkgDir}/${f} differs from the committed package's: the wasm-bindgen glue must be identical`);
      process.exit(1);
    }
  }
}
const { default: init, verify_receipt, check_signature, parse_receipt, issuer_claim, issuer_binding, version } = await import(pathToFileURL(path.join(pkgDir, "zeceipt_wasm.js")).href);
console.log(`package: ${pkgDir}`);
const wasm = fs.readFileSync(path.join(pkgDir, "zeceipt_wasm_bg.wasm"));

let failures = 0;
const check = (name, cond, detail) => { if (!cond) { failures++; console.error("FAIL", name, detail ?? ""); } else console.log("ok  ", name); };

// Built by scripts/build_wasm.sh (slice X3a): no absolute path of the machine that built it, which would make the
// package unreproducible elsewhere and ship the builder's paths. /rustc/<commit>/ (the standard library's own) and the
// remapped /cargo/registry/src/ and /zeceipt/ are expected.
const LOCAL_PATH = /(?:\/Users\/|\/home\/|\/root\/|\/Volumes\/|\/var\/folders\/|\/private\/|\/tmp\/|[A-Z]:\\Users\\|[A-Z]:\/Users\/)[\x21-\x7e]{0,60}/g;
const localPaths = [...wasm.toString("latin1").matchAll(LOCAL_PATH)].map((m) => m[0]);
check("the committed WASM carries no local build path (built by scripts/build_wasm.sh)", localPaths.length === 0, JSON.stringify(localPaths.slice(0, 3)));

await init({ module_or_path: wasm });
// The JS wrapper imports the committed glue; hand it this build's bytes (the glue must be identical: build_wasm.sh
// compares it), so the wrapper's checks below run against the build under test.
await (await import("../src/index.js")).initVerifier(wasm);

const receipt = fs.readFileSync(path.join(here, "../demo/fixtures/synthetic-receipt.json"), "utf8");
const rawTx = fs.readFileSync(path.join(here, "../demo/fixtures/synthetic-ironwood.hex"), "utf8").trim();

const ok = verify_receipt(receipt, rawTx, "auditor-nonce-7", true);
check("valid receipt verifies", ok.valid === true, JSON.stringify(ok));
check("value is 2.5 ZEC", ok.value_zat === 250000000, ok.value_zat);
check("recipient is a mainnet UA", typeof ok.recipient === "string" && ok.recipient.startsWith("u1"), ok.recipient);
check("memo text", ok.memo && ok.memo.text === "INV-2026-0142", JSON.stringify(ok.memo));
check("challenge bound", ok.challenge_checked === true);
check("does_not_prove names the output being unspent, as spec §4 does (slice A4; R132)", /that the output is still unspent, or that whoever presents the receipt can spend it/.test(ok.does_not_prove) && /^who is presenting this receipt;/.test(ok.does_not_prove), ok.does_not_prove);
check("the package README quotes does_not_prove word for word (review A4)", fs.readFileSync(path.join(here, "../README.md"), "utf8").includes(`**Does not prove:** ${ok.does_not_prove};`), ok.does_not_prove);
check("receipt page: its 'does not prove' list names the unspent point, and no longer sends depth to an explorer", /That the output is still unspent, or that whoever shows you the receipt can spend it/.test(fs.readFileSync(path.join(here, "../r/index.html"), "utf8")) && !/How many confirmations the transaction has/.test(fs.readFileSync(path.join(here, "../r/index.html"), "utf8")));
check("proves says what spec §4 says: whoever produced the receipt knew the OCK, never 'the issuer' (slice D5)",
  /whoever produced this receipt knew this output's OCK, as does anyone holding an earlier receipt for it/.test(ok.proves) && !/the issuer knew/.test(ok.proves), ok.proves);

const r = JSON.parse(receipt);
const flip = (mut) => { const c = JSON.parse(JSON.stringify(r)); mut(c); return verify_receipt(JSON.stringify(c), rawTx, "auditor-nonce-7", true); };
check("network flip -> signature", flip((c) => { c.network = "test"; }).stage === "signature");
check("pool flip -> signature", flip((c) => { c.pool = "orchard"; }).stage === "signature");
check("key id flip -> signature", flip((c) => { c.issuer_key_id = "x"; }).stage === "signature");
check("label flip -> signature", flip((c) => { c.label += "!"; }).stage === "signature");
check("wrong challenge -> challenge", verify_receipt(receipt, rawTx, "nope", true).stage === "challenge");
const unsignedTamper = (() => { const c = JSON.parse(receipt); delete c.signature; delete c.issuer_pubkey; c.ock = c.ock.slice(0, -1) + (c.ock.endsWith("A") ? "B" : "A"); return verify_receipt(JSON.stringify(c), rawTx, "auditor-nonce-7", false); })();
check("tampered ock (unsigned) -> recovery", unsignedTamper.stage === "recovery", JSON.stringify(unsignedTamper));
// Slice U2 (R127, Zebra's GHSA-h5rr-8pqv-grp9): a real mainnet v6 Orchard transaction with a pre-NU6.3 branch in its
// header can never be consensus-valid; the WASM refuses it at stage "tx", as malformed.
const orchardV6 = fs.readFileSync(path.join(here, "../../../fixtures/368ff5b2a985d39594fd69281bfad0531a7f495d4cb23f443e73d5e1ca93d047.hex"), "utf8").trim();
const nu61 = orchardV6.slice(0, 16) + "f04dec4d" + orchardV6.slice(24); // NU6.1's branch 0x4dec4df0, little-endian
const preNu63 = verify_receipt(receipt, nu61, "auditor-nonce-7", true);
check("v6 under a pre-NU6.3 branch -> tx (malformed)", preNu63.stage === "tx" && /cannot use consensus branch 0x4dec4df0/.test(preNu63.error), JSON.stringify(preNu63));
check("the same transaction as mined -> txid (it parses)", verify_receipt(receipt, orchardV6, "auditor-nonce-7", true).stage === "txid");
// Slice U5 (R131): a note value above MAX_MONEY is refused at stage "recovery", never shown as VALID (the build before
// U5 reported this synthetic output as valid, 21000000.00000001 ZEC) and never returned as null.
const aboveMax = verify_receipt(
  fs.readFileSync(path.join(here, "../../../fixtures/synthetic-above-max-money-receipt.json"), "utf8"),
  fs.readFileSync(path.join(here, "../../../fixtures/synthetic-above-max-money.hex"), "utf8").trim(), "", false);
check("value above MAX_MONEY -> recovery, not valid, not null", aboveMax !== null && aboveMax.valid === false && aboveMax.stage === "recovery" && /above MAX_MONEY/.test(aboveMax.error), JSON.stringify(aboveMax));
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

// fetchChainTip and confirmations (slice A1; R132): GetLatestBlock over gRPC-web, as a hand-built BlockID
// { uint64 height = 1; bytes hash = 2 }, and Zcash's count of confirmations (tip - height + 1).
const { fetchChainTip, confirmations } = await import("../src/index.js");
const blockId = (height) => new Uint8Array([0x08, ...varint(height), 0x12, 32, ...new Uint8Array(32).fill(7)]);
seen.length = 0;
const tip = await withFetch(() => ok200(grpcBody(blockId(3499230n))), () => fetchChainTip("main", ["https://node.test"]));
check("tip: the BlockID height comes back as a number, with the endpoint", tip.height === 3499230 && tip.endpoint === "https://node.test", JSON.stringify(tip));
check("tip: the request is GetLatestBlock with one empty ChainSpec", seen[0]?.url === "https://node.test/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock" && seen[0]?.init?.body?.length === 5 && [...seen[0].init.body].every((b) => b === 0), JSON.stringify(seen[0]?.url));
seen.length = 0;
const tipFailover = await withFetch((url) => url.startsWith("https://down.test") ? new Response("", { status: 503 }) : ok200(grpcBody(blockId(12n))), () => fetchChainTip("main", ["https://down.test", "https://up.test"]));
check("tip: fails over to the next endpoint", tipFailover.endpoint === "https://up.test" && tipFailover.height === 12 && seen.length === 2);
const tipEmpty = await rejects(withFetch(() => ok200(grpcBody(null)), () => fetchChainTip("main", ["https://node.test"])));
check("tip: a response without a message is an error", /empty gRPC-web response/.test(tipEmpty ?? ""), tipEmpty);
const tipZero = await rejects(withFetch(() => ok200(grpcBody(new Uint8Array([0x12, 0]))), () => fetchChainTip("main", ["https://node.test"])));
check("tip: a BlockID without a height is no usable tip", /no usable chain tip/.test(tipZero ?? ""), tipZero);
const tipGarbled = await rejects(withFetch(() => ok200(grpcBody(new Uint8Array([0x0b, 1, 2]))), () => fetchChainTip("main", ["https://node.test"])));
check("tip: a garbled message is an error", /unexpected wire type/.test(tipGarbled ?? ""), tipGarbled);
const tipStatus = await rejects(withFetch(() => ok200(grpcBody(null, 14, "unavailable")), () => fetchChainTip("main", ["https://node.test"])));
check("tip: a non-zero grpc-status trailer is an error", /grpc trailer/.test(tipStatus ?? ""), tipStatus);
const tipRegtest = await rejects(fetchChainTip("regtest", undefined));
check("tip: regtest without endpoints is refused clearly", /no public gRPC-web endpoint for regtest/.test(tipRegtest ?? ""), tipRegtest);
check("confirmations: 1 at the tip, tip - height + 1 below it", confirmations(100, 100) === 1 && confirmations(100, 109) === 10);
check("confirmations: null for a tip below the height, an unknown height or tip, or a non-positive height",
  [confirmations(100, 99), confirmations(null, 100), confirmations(100, null), confirmations(0, 5), confirmations(100.5, 200)].every((c) => c === null));
// Per-endpoint timeouts (slice A1b): an endpoint that accepts the request and then never answers is abandoned after
// timeoutMs, and the next is tried; with every endpoint hanging, the error says so.
// Node's AbortSignal.timeout timer is unref'd: with only these mocked, hanging promises pending, nothing else would keep
// the process alive until it fires (a real socket would), so a ref'd interval holds the loop open for these checks.
const keepAlive = setInterval(() => {}, 1000);
const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
const hangFirst = (answer) => (url, init) => url.startsWith("https://hang.test") ? hang(url, init) : answer;
const txAfterHang = await withFetch(hangFirst(ok200(grpcBody(rawTxMessage(rawTx, 12n)))), () => fetchRawTx(TXID, "main", ["https://hang.test", "https://up.test"], { timeoutMs: 50 }));
check("timeout: fetchRawTx moves past a hanging endpoint", txAfterHang.endpoint === "https://up.test");
const tipAfterHang = await withFetch(hangFirst(ok200(grpcBody(blockId(12n)))), () => fetchChainTip("main", ["https://hang.test", "https://up.test"], { timeoutMs: 50 }));
check("timeout: fetchChainTip moves past a hanging endpoint", tipAfterHang.endpoint === "https://up.test" && tipAfterHang.height === 12);
const allHang = await rejects(withFetch(hang, () => fetchChainTip("main", ["https://hang.test"], { timeoutMs: 50 })));
check("timeout: with every endpoint hanging, the error names the wait", /https:\/\/hang\.test: no answer within 0\.05 s/.test(allHang ?? ""), allHang);
const txAllHang = await rejects(withFetch(hang, () => fetchRawTx(TXID, "main", ["https://hang.test"], { timeoutMs: 50 })));
check("timeout: the same for fetchRawTx", /no answer within 0\.05 s/.test(txAllHang ?? ""), txAllHang);
seen.length = 0;
await withFetch(() => ok200(grpcBody(blockId(1n))), () => fetchChainTip("main", ["https://node.test"]));
check("timeout: every request carries an abort signal", seen[0]?.init?.signal instanceof AbortSignal);
clearInterval(keepAlive);
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
const node = (chain, tip = null) => ({ kind: "node", chain, endpoint: "https://zjs.zec.rocks/mainnet", tip });
// Depth (slice A2; R132): Zcash's count from the same node's tip, read against ZIP 315; no tip, no depth.
const deep = pageView.outcome(good, node({ status: "mined", height: 12 }, 21)).inclusion;
check("receipt page: mined inclusion names the node and counts confirmations", deep.confirmations === 10 && deep.text === "Mined at height 12, 10 confirmations, according to zjs.zec.rocks/mainnet. ZIP 315 recommends 10 confirmations before spending funds from an untrusted sender.", deep.text);
check("receipt page: one confirmation at the tip is singular", /, 1 confirmation, according/.test(pageView.inclusion(node({ status: "mined", height: 12 }, 12)).text));
const shallow = pageView.inclusion(node({ status: "mined", height: 12 }, 11));
check("receipt page: while the tip is being asked (undefined), the line says so", /; asking it for its chain tip…$/.test(pageView.inclusion({ kind: "node", chain: { status: "mined", height: 12 }, endpoint: "https://zjs.zec.rocks/mainnet" }).text));
check("receipt page: no tip, or a tip below the height, leaves the depth unknown", shallow.state === "mined" && shallow.confirmations === null && /the depth is unknown/.test(shallow.text) && /the depth is unknown/.test(pageView.inclusion(node({ status: "mined", height: 12 })).text), shallow.text);
check("receipt page: mempool is pending, fork is not the main chain, a file is unknown",
  pageView.inclusion(node({ status: "mempool" })).state === "pending" && pageView.inclusion(node({ status: "fork" })).state === "fork" && pageView.inclusion({ kind: "file" }).state === "unknown");
check("receipt page: signed issuer says binding unknown; unsigned says the label is unauthenticated",
  pageView.issuerLines(good).join(" ").includes("issuer binding: unknown") && /^Unsigned: the label is the sender's unauthenticated text/.test(pageView.issuerLines({ ...good, issuer_pubkey: undefined })[0]));
check("receipt page: challenge line for bound and bearer receipts", /matched/.test(pageView.challengeLine({ challenge_checked: true })) && /does not prove who is showing it/.test(pageView.challengeLine({ challenge_checked: false })));
check("receipt page: memo text for text, empty and bytes", pageView.memoText({ kind: "text", text: "a" }) === "a" && pageView.memoText({ kind: "empty" }) === "(empty)" && pageView.memoText({ kind: "bytes", hex: "00ff" }) === "bytes 00ff");
check("receipt page: fetch plan names the nodes, and explains regtest",
  /zjs\.zec\.rocks\/mainnet, then zcash-mainnet\.chainsafe\.dev/.test(pageView.fetchPlan("main", GRPC_WEB_ENDPOINTS.main).note) && pageView.fetchPlan("regtest", undefined).canFetch === false);
// Slice RS4 (R125): testnet has a fallback, and the note says a proxy's backend (ChainSafe's is zec.rocks) also learns the txid.
const testPlan = pageView.fetchPlan("test", GRPC_WEB_ENDPOINTS.test);
check("receipt page: testnet fetch plan names both endpoints, and any service behind them",
  testPlan.canFetch && /\(zjs\.zec\.rocks\/testnet, then zcash-testnet\.chainsafe\.dev\), and any service behind it, learns which transaction you look up/.test(testPlan.note), testPlan.note);
const pageHtml = fs.readFileSync(path.join(here, "../r/index.html"), "utf8");
check("receipt page states what a valid result proves, and what it does not", /What a valid result proves/.test(pageHtml) && /What it does not prove/.test(pageHtml));
check("receipt page has no inline script or style (CSP allows 'self' only)", !/<script(?![^>]*\bsrc=)[^>]*>/i.test(pageHtml) && !/<style|\sstyle=/i.test(pageHtml));
check("receipt page sends no Referer", /<meta name="referrer" content="no-referrer">/.test(pageHtml));
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(pageHtml)?.[1] ?? "";
const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? "").split(/\s+/);
const origins = [...new Set(Object.values(GRPC_WEB_ENDPOINTS).flat().map((u) => new URL(u).origin))];
check("receipt page CSP connect-src covers every public gRPC-web endpoint", origins.every((o) => connect.includes(o)), `missing: ${origins.filter((o) => !connect.includes(o)).join(" ")}`);
check("receipt page CSP is default-deny with WebAssembly allowed", /default-src 'none'/.test(csp) && /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && /form-action 'none'/.test(csp) && /base-uri 'none'/.test(csp));
check("receipt page CSP admits the well-known path on any HTTPS host, not https: (spec §7, slice W3b)", connect.includes("https://*/.well-known/zeceipt.json") && !connect.includes("https:") && !connect.includes("*"));
check("receipt page states both requests it can make, each only when asked", /only when you ask/.test(pageHtml) && /issuer check tells the named domain/.test(pageHtml));
check("issuer check copy: the offer names the domain and what the request tells it",
  pageView.bindingOffer("pay.example.org").button === "Check with pay.example.org" && /tells pay\.example\.org that one of its receipts is being checked/.test(pageView.bindingOffer("pay.example.org").note));
check("issuer check copy: confirmed is 'now'; not listed and unknown keep the payment proven",
  /vouches for the key now; this does not say when the receipt was made/.test(pageView.bindingText({ state: "confirmed", domain: "d.example" }).text)
  && /still proven/.test(pageView.bindingText({ state: "not_listed", domain: "d.example" }).text)
  && /^Unknown: x\. The payment above is still proven\.$/.test(pageView.bindingText({ state: "unknown", reason: "x" }).text));
const pageJs = fs.readFileSync(path.join(here, "../r/page.js"), "utf8");
check("receipt page writes the DOM with textContent only (no innerHTML/outerHTML/insertAdjacentHTML)", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(pageJs));
check("receipt page stores nothing", !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(pageJs));

// Issuer binding (spec §7; slice W3a): the claim in the signed key id, the comparison, and the lookup's rules.
{
  const { checkIssuerBinding, issuerClaim } = await import("../src/index.js");
  const fx = (n) => fs.readFileSync(path.join(here, "../demo/fixtures", n), "utf8");
  const claimed = fx("binding-receipt.json");
  const ours = fx("binding-well-known.json");
  const theirs = fx("binding-well-known-other.json");
  const enc = (t) => new TextEncoder().encode(t);
  check("issuer_claim: a signed receipt claims the domain in its key id, with the file's URL",
    (() => { const c = issuer_claim(claimed).claim; return c?.label === "2026-09" && c.domain === "pay.example.org" && c.url === "https://pay.example.org/.well-known/zeceipt.json"; })(), JSON.stringify(issuer_claim(claimed)));
  check("issuer_claim: a plain key id claims nothing", issuer_claim(receipt).binding?.state === "unknown");
  const altered = JSON.stringify({ ...JSON.parse(claimed), label: "altered" });
  check("issuer_claim: a receipt whose signature fails claims nothing", issuer_claim(altered).binding?.state === "unknown");
  const yes = issuer_binding(claimed, "pay.example.org", enc(ours));
  check("issuer_binding: confirmed by the domain's own file", yes.state === "confirmed" && yes.domain === "pay.example.org" && Object.keys(yes).length === 2, JSON.stringify(yes));
  check("issuer_binding: not listed when the domain lists another key", issuer_binding(claimed, "pay.example.org", enc(theirs)).state === "not_listed");
  check("issuer_binding: a file from another domain vouches for nothing", issuer_binding(claimed, "evil.example.net", enc(ours)).state === "unknown");
  check("issuer_binding: junk is unknown", issuer_binding(claimed, "pay.example.org", enc("<html>")).state === "unknown");

  // The lookup's rules, with a stub fetch: the URL, no redirects, no credentials or referrer, 200 only, 64 KiB.
  const calls = [];
  const stub = (res) => async (url, init) => { calls.push({ url, init }); if (res instanceof Error) throw res; return res; };
  const confirmed = await checkIssuerBinding(claimed, { fetchImpl: stub(new Response(ours, { status: 200 })) });
  check("checkIssuerBinding: confirmed", confirmed.state === "confirmed" && confirmed.domain === "pay.example.org", JSON.stringify(confirmed));
  const init0 = calls[0].init;
  check("checkIssuerBinding: fetches exactly the claimed URL", calls[0].url === "https://pay.example.org/.well-known/zeceipt.json");
  check("checkIssuerBinding: no redirects, no credentials, no referrer, no cache", init0.redirect === "error" && init0.credentials === "omit" && init0.referrerPolicy === "no-referrer" && init0.cache === "no-store");
  check("checkIssuerBinding: a 404 is unknown", (await checkIssuerBinding(claimed, { fetchImpl: stub(new Response("", { status: 404 })) })).reason === "pay.example.org answered HTTP 404");
  const redirected = await checkIssuerBinding(claimed, { fetchImpl: stub(new TypeError("Failed to fetch")) });
  check("checkIssuerBinding: a rejected fetch (a redirect, CORS, the page's policy) is unknown", redirected.state === "unknown" && /request failed/.test(redirected.reason));
  const big = await checkIssuerBinding(claimed, { fetchImpl: stub(new Response(new Uint8Array(64 * 1024 + 1), { status: 200 })) });
  check("checkIssuerBinding: over 64 KiB is unknown", big.state === "unknown" && /larger than 64 KiB/.test(big.reason));
  const exact = ours + " ".repeat(64 * 1024 - enc(ours).length);
  check("checkIssuerBinding: exactly 64 KiB is read", (await checkIssuerBinding(claimed, { fetchImpl: stub(new Response(exact, { status: 200 })) })).state === "confirmed");
  const before = calls.length;
  check("checkIssuerBinding: a receipt that claims nothing makes no request", (await checkIssuerBinding(receipt, { fetchImpl: stub(new Response(ours)) })).state === "unknown" && calls.length === before);
  check("issuerClaim (JS) is the WASM export", JSON.stringify(issuerClaim(claimed)) === JSON.stringify(issuer_claim(claimed)));
}

// The receipt page's verdict line and amount split (slice F2, review F round 1).
{
  const { verdictNote, valueParts } = pageView;
  check("verdictNote: mined says proven and mined", /proven, and the node reports its transaction mined/.test(verdictNote({ valid: true, inclusion: { state: "mined" } })));
  for (const state of ["file", "mempool", "fork", "unknown"]) check(`verdictNote: ${state} says inclusion not confirmed`, /not confirmed/.test(verdictNote({ valid: true, inclusion: { state } })));
  check("verdictNote: INVALID has none (the stage copy speaks)", verdictNote({ valid: false }) === "");
  for (const t of ["2.50000000", "0.00000000", "12.34567891", "not a value"]) {
    const v = valueParts(t);
    check(`valueParts joins back to ${JSON.stringify(t)}`, v.major + v.zeros === t, JSON.stringify(v));
  }
  const v = valueParts("2.50000000");
  check("valueParts: 2.5 with seven lighter zeros", v.major === "2.5" && v.zeros === "0000000", JSON.stringify(v));
  check("valueParts: 0.0 keeps one digit after the point", valueParts("0.00000000").major === "0.0");
  const view = pageView.outcome({ valid: true, recipient: "u1x", value_zec: "2.50000000", value_zat: "250000000", memo: { kind: "empty" }, label: "", pool: "ironwood", output_index: 0, txid: "ab" }, { kind: "file" });
  check("outcome carries the amount as data (review F round 2)", view.amount.zec === "2.50000000" && view.amount.zat === "250000000", JSON.stringify(view.amount));
}

// The demo shows the page's own proves / does-not-prove lists, word for word (review F round 4).
{
  const scope = (f) => { const h = fs.readFileSync(path.join(here, f), "utf8"); return h.slice(h.indexOf('<div class="scope">'), h.indexOf("</div>", h.indexOf("</ul>\n</section>\n</div>")) + 6); };
  check("the demo's proves / does-not-prove lists are the page's", scope("../demo/index.html") === scope("../r/index.html"));
  check("the demo's sample is named as the synthetic sample", /synthetic sample, which is on no chain/.test(pageView.inclusion({ kind: "sample" }).text));
  check("pasted bytes are named as pasted, not as a file", /supplied on this page/.test(pageView.inclusion({ kind: "pasted" }).text) && pageView.inclusion({ kind: "pasted" }).state === "unknown");
}

console.log(version(), failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
