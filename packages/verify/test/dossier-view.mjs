// Unit checks for the dossier pages' pure logic (case/view.js, build/view.js) and their static guarantees (no inline
// script, a default-deny CSP naming the public nodes, the committed sample identical to the fixture), on the real
// testnet dossier (fixtures/dossier/, its transactions in fixtures/testnet/) checked offline by the committed WASM.
// Usage: node packages/verify/test/dossier-view.mjs (CI runs it after verify.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const repo = path.join(root, "..", "..");
const read = (p) => fs.readFileSync(p, "utf8");

const { initVerifier, checkDossier, dossierTxids, buildDossier, GRPC_WEB_ENDPOINTS } = await import("../src/index.js");
const cv = await import("../case/view.js");
const bv = await import("../build/view.js");
await initVerifier(fs.readFileSync(path.join(root, "pkg/zeceipt_wasm_bg.wasm")));

let failures = 0;
const check = (name, cond, detail) => { if (!cond) { failures++; console.error("FAIL", name, detail ?? ""); } else console.log("ok  ", name); };

const SAMPLE = read(path.join(repo, "fixtures/dossier/testnet-dossier.json"));
const hex = (t) => read(path.join(repo, "fixtures/testnet", `${t}.hex`)).trim();
const HEIGHTS = { "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b": 4419987, fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b: 4420000, "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d": 4420003, a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8: 4420005, "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43": 4421345 };
const chain = (text, drop = []) => Object.fromEntries(dossierTxids(text).filter((t) => !drop.includes(t)).map((t) => [t, { hex: hex(t), height: HEIGHTS[t] ?? null }]));
const report = await checkDossier(SAMPLE, { txs: chain(SAMPLE) });
const dossier = JSON.parse(SAMPLE);
const tamper = (mut) => { const d = JSON.parse(SAMPLE); mut(d); return JSON.stringify(d, null, 2); };

// ---- the fragment and the input ----
{
  const text = '{"a":"é ✓ 𝛼"}';
  check("base64url round-trips UTF-8, with no padding or +/", cv.fromBase64Url(cv.toBase64Url(text)) === text && !/[=+/]/.test(cv.toBase64Url(SAMPLE)));
  check("base64url decodes Node's encoding", cv.fromBase64Url(Buffer.from(SAMPLE).toString("base64url")) === SAMPLE);
  check("JSON input is kept exactly as given (the report hashes the holder's file)", cv.readDossierInput(SAMPLE).text === SAMPLE && cv.readDossierInput(`  ${SAMPLE}`).text === `  ${SAMPLE}`);
  const b = Buffer.from(SAMPLE).toString("base64url");
  check("a case link opens its fragment", cv.readDossierInput(`https://x.example/zeceipt/case/#${b}`).text === SAMPLE);
  check("a bare base64url payload opens", cv.readDossierInput(b).text === SAMPLE);
  check("#sample and sample open the sample", cv.readDossierInput("#sample").sample === true && cv.readDossierInput("https://x.example/case/#sample").sample === true);
  check("anything else is refused with a reason", /not a dossier/.test(cv.readDossierInput("#hello world").error) && /Nothing to check/.test(cv.readDossierInput("  ").error));
  check("caseLink replaces any fragment", cv.caseLink("https://x.example/case/#old", "{}") === `https://x.example/case/#${cv.toBase64Url("{}")}`);
  check("the sample path is the committed copy", cv.SAMPLE_PATH === "fixtures/testnet-dossier.json" && cv.SAMPLE_FRAGMENT === "sample");
}

// ---- amounts and wording ----
check("formatZat", cv.formatZat(24743750) === "0.24743750" && cv.formatZat(100000000) === "1.00000000" && cv.formatZat(0) === "0.00000000");
check("amountText names TAZ off mainnet and ZEC on it", cv.amountText(24743750, "test") === "0.2474375 TAZ" && cv.amountText(100000000, "main") === "1.0 ZEC" && cv.amountText(undefined, "main") === "value unknown");
check("fetchProgress", cv.fetchProgress(2, 5, "https://zjs.zec.rocks/testnet") === "Fetching 3 of 5 from zjs.zec.rocks/testnet…", cv.fetchProgress(2, 5, "https://zjs.zec.rocks/testnet"));
check("fetchProgress: the funders' round", cv.fetchProgress(0, 2, "https://zjs.zec.rocks/mainnet", 1) === "Fetching the funders' transactions, 1 of 2, from zjs.zec.rocks/mainnet…");
check("shortTxid is the core's (8…4)", cv.shortTxid("90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b") === "90f6a335…2a4b");

// ---- the verdict ----
{
  const v = cv.caseVerdict(report);
  check("the sample: All 12 claims verified, in the ok tone", report.all_verified && v.tone === "ok" && v.headline === "All 12 claims verified", JSON.stringify(v));
  check("the sample's breakdown", v.sub === "Every claim holds against the chain: 1 origin, 7 path hops, 3 deposits and 1 control answer.", v.sub);
  const wrongNonce = tamper((d) => { d.claims[11].nonce = "zeceipt-challenge-00000000000000000000000000000000"; });
  const r2 = await checkDossier(wrongNonce, { txs: chain(wrongNonce) });
  const v2 = cv.caseVerdict(r2);
  check("a changed nonce: 1 claim failed, bad tone, the control row failed", v2.tone === "bad" && v2.headline === "1 claim failed" && r2.claims[11].status === "failed" && /does not carry the nonce/.test(r2.claims[11].summary), JSON.stringify(v2));
  const r3 = await checkDossier(SAMPLE, { txs: { ...chain(SAMPLE), "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43": { hex: hex("10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43"), height: null, mempool: true } } });
  const v3 = cv.caseVerdict(r3);
  check("a challenge in the mempool: Not all checked, pending tone", v3.tone === "pending" && v3.headline === "Not all checked" && /11 of 12 verified/.test(v3.sub), JSON.stringify(v3));
  const v4 = cv.caseVerdict(await checkDossier("{not json", {}));
  check("an unreadable dossier: bad, with the verifier's reason", v4.tone === "bad" && v4.headline === "Not a readable dossier" && /not JSON/.test(v4.sub), JSON.stringify(v4));
  check("one claim reads as one", cv.caseVerdict({ all_verified: true, claims: [{ kind: "origin", status: "verified" }] }).headline === "1 claim verified");
}

// ---- the funds flow ----
{
  const payments = { r1: { recipient: "utest19q", value_zat: 1000000, memo: "INV-T-001" } };
  const steps = cv.flowSteps(dossier, report, { heights: HEIGHTS, payments });
  check("five steps, one per transaction, oldest first", steps.length === 5 && steps.every((s, i) => i === 0 || s.height >= steps[i - 1].height), steps.map((s) => s.height).join(" "));
  check("stages: origin, three hops, control", steps.map((s) => s.stage).join(" ") === "origin hop hop hop control", steps.map((s) => s.stage).join(" "));
  check("every claim is one edge, and each carries its status", steps.flatMap((s) => s.edges).length === 12 && steps.flatMap((s) => s.edges).every((e) => e.status === "verified"));
  const [o, h1, h2, h3, c] = steps;
  check("origin: n1, 1.0 TAZ, at 4419987, funded by shielded funds", o.created[0].id === "n1" && o.created[0].value === "1.0 TAZ" && o.height === 4419987 && /shielded funds of an undisclosed sender/.test(o.funding[0].text) && o.txid === "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b");
  check("hop 1 spent n1, created n2..n5, paid r1 with its receipt's facts", h1.spent.map((n) => n.id).join() === "n1" && h1.created.map((n) => n.id).join() === "n2,n3,n4,n5" && h1.payments[0].id === "r1" && h1.payments[0].value === "0.01 TAZ" && h1.payments[0].memo === "INV-T-001" && h1.title === "Moved within the wallet, and paid out");
  check("each created note points to the step that spends it", h1.created.find((n) => n.id === "n2").next === 3 && h1.created.find((n) => n.id === "n3").next === 4 && h1.created.find((n) => n.id === "n4").next === 5 && h1.created.find((n) => n.id === "n5").next === null && o.created[0].next === 2);
  check("a deposit's value comes from the report without the receipt's facts", h2.payments[0].value === "0.02 TAZ" && h2.payments[0].recipient === null);
  check("hop 3 created n7 and n8", h3.created.map((n) => n.id).join() === "n7,n8");
  check("control: spent n4, paid n9 whose memo is the nonce", c.spent.map((n) => n.id).join() === "n4" && c.created[0].id === "n9" && c.created[0].reply && c.created[0].memo === dossier.claims[11].nonce && c.nonce === dossier.claims[11].nonce);
  const failed = await checkDossier(SAMPLE, { txs: chain(SAMPLE, ["a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8"]) });
  const fsteps = cv.flowSteps(dossier, failed, {});
  const bad = fsteps.find((s) => s.edges.some((e) => e.index === 8));
  check("a missing transaction: its step is failed or not checked, and the others hold", bad && bad.status !== "verified" && fsteps.filter((s) => s.status === "verified").length >= 3, JSON.stringify(fsteps.map((s) => [s.txid.slice(0, 8), s.status])));
  check("fundingText: transparent inputs name the addresses they spent from, and their value", cv.fundingText({ transparent_inputs: [{ prevout: "ab:0", address: "tmA", value_zat: 150000000 }, { prevout: "cd:1", address: "tmA", value_zat: 50000000 }], shielded_actions: 0, sapling_spends: 0, from_disclosed: [] }, "test") === "From 2 transparent inputs (2.0 TAZ), paid from tmA.");
  check("fundingText: an input whose previous transaction was not fetched has no value", cv.fundingText({ transparent_inputs: [{ prevout: "ab:0" }], shielded_actions: 0, sapling_spends: 0, from_disclosed: [] }, "main") === "From 1 transparent input.");
}

// ---- rows, facts, summary, download ----
{
  const rows = cv.claimRows(report);
  check("claim rows: 12, numbered from 1, labelled, TAZ", rows.length === 12 && rows[0].number === 1 && rows[0].kindLabel === "Origin" && rows[0].statusLabel === "Verified" && /^1\.00000000 TAZ /.test(rows[0].summary) && rows[11].kindLabel === "Control");
  const facts = Object.fromEntries(cv.caseFacts(dossier, report, { checkedAt: "2026-09-30T12:56:00.000Z", nodes: ["https://zjs.zec.rocks/testnet"] }));
  check("case facts: the subject is marked unauthenticated; network, sha256, checked, built", facts["Subject (unauthenticated)"] === dossier.subject && facts.Network === "Zcash testnet" && facts["Dossier sha256"] === report.dossier_sha256 && facts.Checked === "2026-09-30 12:56 UTC against zjs.zec.rocks/testnet" && facts["Built (per the holder)"] === "2026-09-30 12:37 UTC", JSON.stringify(facts));
  const nonce = cv.nonceCheck(dossier, report, null);
  check("the report says the account's nk is proven on chain; control counts only against the reviewer's nonce", report.nk_proven === true && report.controlled === false);
  const text = cv.caseSummaryText(dossier, report, { checkedAt: "2026-09-30T12:56:00.000Z", nonce });
  check("the case summary: headline, sha256, every claim, the scope", text.startsWith("Zeceipt case review: All 12 claims verified") && text.includes(report.dossier_sha256) && text.includes("12. Control, verified:") && text.includes("This does not prove:") && text.includes(nonce.text));
  const dl = cv.reportForDownload(report, { checkedAt: "t", nodes: ["n"], verifier: "v", nonce, generated: null });
  check("the downloaded report is the verifier's, with when and where it was checked", dl.version === "zeceipt-dossier-report-v1" && dl.dossier_sha256 === report.dossier_sha256 && dl.claims.length === 12 && dl.case.checked_at === "t" && dl.case.nodes[0] === "n" && dl.case.reviewer_nonce.state === "not-generated");
  check("the report's file name carries the dossier hash", cv.reportFileName(report) === `zeceipt-case-${report.dossier_sha256.slice(0, 12)}.json`);
}

// ---- the reviewer's nonce ----
{
  const n = cv.newNonce(Uint8Array.from({ length: 16 }, (_, i) => i * 17));
  check("newNonce: zeceipt-challenge- and 32 hex", /^zeceipt-challenge-[0-9a-f]{32}$/.test(n) && n === "zeceipt-challenge-00112233445566778899aabbccddeeff", n);
  let threw = false;
  try { cv.newNonce(new Uint8Array(8)); } catch { threw = true; }
  check("newNonce wants 16 bytes", threw);
  const own = dossier.claims[11].nonce;
  check("nonceCheck: the nonce generated here, verified", cv.nonceCheck(dossier, report, own).state === "match");
  check("nonceCheck: another nonce is a mismatch, named", (() => { const r = cv.nonceCheck(dossier, report, n); return r.state === "mismatch" && r.text.includes(own) && r.text.includes(n); })());
  check("nonceCheck: none generated here says compare it", cv.nonceCheck(dossier, report, null).state === "not-generated");
  const failedReport = { ...report, claims: report.claims.map((c) => (c.kind === "control" ? { ...c, status: "failed" } : c)) };
  check("nonceCheck: the right nonce on a failed claim is not a match", cv.nonceCheck(dossier, failedReport, own).state === "match-unverified");
  const expected = await checkDossier(SAMPLE, { txs: chain(SAMPLE), expectNonce: own });
  check("expectNonce: the nonce the dossier answers verifies, with no 'check the nonce' note", expected.all_verified && !(expected.claims[11].details ?? []).some((d) => /Check that this is the nonce/.test(d)));
  const other = await checkDossier(SAMPLE, { txs: chain(SAMPLE), expectNonce: n });
  check("expectNonce: another nonce fails the control claim, and the page's words agree", other.claims[11].status === "failed" && /not the one you issued/.test(other.claims[11].summary) && cv.caseVerdict(other).headline === "1 claim failed" && cv.nonceCheck(dossier, other, n).state === "mismatch");
  check("nonceCheck: no control claim", cv.nonceCheck({ claims: [{ type: "origin", note: "n1" }] }, report, n).state === "no-control");
}

// ---- the builder's form, errors and summary ----
{
  const UFVK = read(path.join(repo, "fixtures/testnet/issuer-ufvk.txt")).trim();
  const TX = ["90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b", "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b", "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d", "a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8"];
  const CTL = "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43";
  const NONCE = dossier.claims[11].nonce;
  const form = { network: "test", ufvk: UFVK, txids: TX.join("\n"), nonce: NONCE, controlTxid: CTL, subject: "" };
  const ok = bv.validateBuild({ ...form, txids: `\n ${TX.join(" \n")}\n\n` });
  check("validateBuild: the sample's inputs", ok.ok && ok.input.txids.join() === TX.join() && ok.input.control.txid === CTL && ok.input.subject === null);
  const err = (patch) => bv.validateBuild({ ...form, ...patch });
  check("validateBuild: no key", err({ ufvk: " " }).field === "ufvk");
  check("validateBuild: not a UFVK", /not a unified full viewing key/.test(err({ ufvk: "zxviews1abc" }).error));
  check("validateBuild: a network mismatch is named before anything is fetched", (() => { const r = err({ network: "main" }); return r.field === "network" && /for Zcash testnet, and the network chosen is Zcash mainnet/.test(r.error); })());
  check("validateBuild: bad hex names its line", /Line 2 is not a transaction id/.test(err({ txids: `${TX[0]}\nnot-a-txid` }).error));
  check("validateBuild: a repeated id", /repeats/.test(err({ txids: `${TX[0]}\n${TX[0]}` }).error));
  check("validateBuild: a nonce without its transaction, and the reverse", err({ controlTxid: "" }).field === "control-txid" && err({ nonce: "" }).field === "nonce");
  check("validateBuild: a short nonce", err({ nonce: "short" }).field === "nonce");
  check("validateBuild: the challenge also listed as funds", /only under Control/.test(err({ txids: `${TX.join("\n")}\n${CTL}` }).error));
  check("ufvkNetwork", bv.ufvkNetwork(UFVK) === "test" && bv.ufvkNetwork("uview1x") === "main" && bv.ufvkNetwork("uviewregtest1x") === "regtest" && bv.ufvkNetwork("x") === null);

  const built = await buildDossier({ ufvk: UFVK, network: "test", hexes: TX.map(hex), controlHex: hex(CTL), control: { txid: CTL, nonce: NONCE } });
  const b = JSON.parse(built);
  check("the builder reproduces the sample from the published testnet UFVK", JSON.stringify([b.nk, b.notes, b.receipts, b.claims]) === JSON.stringify([dossier.nk, dossier.notes, dossier.receipts, dossier.claims]));
  const s = bv.dossierSummary(b, await checkDossier(built, { txs: chain(built) }));
  check("dossierSummary: 9 notes, 3 receipts, 12 claims, all verified", s.notes === 9 && s.receipts === 3 && s.claims === 12 && s.allVerified && s.counts[2][1] === "12 (1 origin, 7 path hops, 3 deposits and 1 control answer)", JSON.stringify(s.counts));
  check("dossierSummary: discloses nk, the openings and the receipts", s.discloses.length === 3 && /^nk, the nullifier key/.test(s.discloses[0]) && /^9 note openings/.test(s.discloses[1]) && /^3 sender receipts/.test(s.discloses[2]));

  const fail = async (o) => { try { await buildDossier(o); return null; } catch (e) { return e; } };
  const zdp = JSON.parse(read(path.join(repo, "fixtures/zdp/testnet.json")));
  check("buildError: a key that sees nothing", /^This key sees nothing in these transactions/.test(bv.buildError(await fail({ ufvk: UFVK, network: "test", hexes: [zdp.txHex] }), "test")));
  check("buildError: a network mismatch from the builder", /^This viewing key is for Zcash testnet, and the network chosen is Zcash mainnet/.test(bv.buildError(await fail({ ufvk: UFVK, network: "main", hexes: [hex(TX[0])] }), "main")));
  check("buildError: bad hex", /is not hex/.test(bv.buildError(await fail({ ufvk: UFVK, network: "test", hexes: ["zz"] }), "test")));
  check("buildError: a wrong nonce", /pays this wallet no note whose memo carries the nonce/.test(bv.buildError(await fail({ ufvk: UFVK, network: "test", hexes: TX.map(hex), controlHex: hex(CTL), control: { txid: CTL, nonce: "zeceipt-challenge-00000000000000000000000000000000" } }), "test")));
  check("buildError: a challenge that spends no disclosed note", /spends none of the notes this dossier discloses/.test(bv.buildError(await fail({ ufvk: UFVK, network: "test", hexes: [], controlHex: hex(CTL), control: { txid: CTL, nonce: NONCE } }), "test")));
  check("buildError: a transaction not found names it and the network", bv.buildError(Object.assign(new Error(`transaction ${TX[0]} not found`), { code: "not_found" }), "test") === "Transaction 90f6a335…2a4b was not found on Zcash testnet: check the id, and that the network is the wallet's.");
}

// ---- the pages themselves ----
{
  const origins = [...new Set(Object.values(GRPC_WEB_ENDPOINTS).flat().map((u) => new URL(u).origin))];
  for (const [name, file, js] of [["case", "case/index.html", ["case/page.js", "case/view.js", "case/ui.js"]], ["build", "build/index.html", ["build/page.js", "build/view.js"]]]) {
    const html = read(path.join(root, file));
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? "").split(/\s+/);
    check(`${name} page: default-deny CSP with WebAssembly, no form action, no base`, /default-src 'none'/.test(csp) && /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && /form-action 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /object-src 'none'/.test(csp));
    check(`${name} page: connect-src is this site and every public gRPC-web node, nothing else`, connect.sort().join(" ") === ["'self'", ...origins].sort().join(" "), connect.join(" "));
    check(`${name} page: no inline script or style, no Referer, one h1`, !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) && !/<style|\sstyle=/i.test(html) && /<meta name="referrer" content="no-referrer">/.test(html) && (html.match(/<h1[\s>]/g) ?? []).length === 1);
    for (const f of js) {
      const src = read(path.join(root, f));
      check(`${f}: textContent only, stores nothing`, !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src));
    }
  }
  const landing = read(path.join(root, "index.html"));
  const lcsp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(landing)?.[1] ?? "";
  check("landing page: no script at all, and a CSP that allows none and connects nowhere", !/<script/i.test(landing) && /default-src 'none'/.test(lcsp) && !/script-src|connect-src/.test(lcsp) && !/<style|\sstyle=/i.test(landing) && (landing.match(/<h1[\s>]/g) ?? []).length === 1);
  check("landing page: the hero, both calls to action, the sample, the receipt tools and GitHub", landing.includes("Prove where your shielded ZEC came from, without handing over your viewing key.") && landing.includes('href="case/">Review a dossier') && landing.includes('href="build/">Build a dossier') && landing.includes('href="case/#sample"') && landing.includes('href="r/"') && landing.includes('href="demo/"') && landing.includes("https://github.com/beautifulrem/zeceipt"));
  check("landing page: the four claim lines are the case page's", Object.values(cv.KIND_BLURB).every((l) => landing.includes(l.replace("your nonce", "the reviewer's nonce"))));
  check("build page: the privacy promise, and the key field is never filled in by the browser", /Your viewing key stays in this page/.test(read(path.join(root, "build/index.html"))) && /<textarea id="ufvk"[^>]*spellcheck="false"[^>]*autocomplete="off"/.test(read(path.join(root, "build/index.html"))));
  check("the case page's sample is the fixture, byte for byte", read(path.join(root, "case", cv.SAMPLE_PATH)) === SAMPLE);
  const site = read(path.join(repo, "scripts/build_site.sh"));
  check("build_site.sh publishes and checks the dossier pages", ["case/index.html", "case/page.js", "case/view.js", "case/ui.js", "case/case.css", "case/fixtures/testnet-dossier.json", "build/index.html", "build/page.js", "build/view.js", "build/build.css", "home.css"].every((f) => site.includes(f)) && /cp "\$src\/index.html"/.test(site));
}


{
  // An origin whose note is never spent in the dossier is "not proven", not "not checked": waiting will not change it.
  const unproven = { claims: [{ index: 0, kind: "origin", status: "unproven", summary: "s" }, { index: 1, kind: "path", status: "verified", summary: "s" }], all_verified: false };
  const v = cv.caseVerdict(unproven);
  check("an unproven claim gives its own banner, not 'check again later'", v.tone === "pending" && v.headline === "1 claim not proven" && /Waiting will not change that/.test(v.sub) && cv.STATUS_LABEL.unproven === "Not proven", JSON.stringify(v));
  const problems = { claims: [{ index: 0, kind: "path", status: "verified", summary: "s" }], all_verified: false, problems: ["You issued a nonce, and no control claim answers it."] };
  check("a report-level problem is the banner's words", cv.caseVerdict(problems).sub.includes("no control claim answers it"));
}

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
