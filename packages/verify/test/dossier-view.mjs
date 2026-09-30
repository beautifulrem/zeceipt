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

const { initVerifier, checkDossier, dossierTxids, dossierPrevoutTxids, buildDossier, GRPC_WEB_ENDPOINTS } = await import("../src/index.js");
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
const withNonceReport = await checkDossier(SAMPLE, { txs: chain(SAMPLE), expectNonce: "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8", issuedAtHeight: 4421300 });
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
  check("#sample and sample open the sample", cv.readDossierInput("#sample").sample === "sample" && cv.readDossierInput("https://x.example/case/#sample").sample === "sample");
  check("#sample-exchange opens the flagship sample, the exchange deposit review", cv.readDossierInput("#sample-exchange").sample === "sample-exchange" && cv.EXCHANGE_SAMPLE === "sample-exchange" && cv.SAMPLES["sample-exchange"] === "fixtures/testnet-dossier-exchange.json");
  check("#sample-transparent opens the second sample; an inherited key is not a sample", cv.readDossierInput("#sample-transparent").sample === "sample-transparent" && cv.SAMPLES["sample-transparent"] === "fixtures/testnet-dossier-transparent-origin.json" && Boolean(cv.readDossierInput("#constructor").error));
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
  const v = cv.caseVerdict(report, dossier);
  check("the sample with no nonce: amber, claims verified but control not shown (history only)", report.all_verified && report.assurance === "verified_history_only" && v.tone === "partial" && v.headline === "Claims verified — control not shown" && v.reason === "no-nonce", JSON.stringify(v));
  check("the sample's breakdown, and the reason: enter the nonce you issued", v.sub === "All 12 claims hold against the chain (1 origin, 7 path hops, 3 deposits and 1 control answer), but the control claim is not matched to your nonce: no expected nonce was given. Enter the nonce you issued under “Challenge the holder”.", v.sub);
  const withNonce = await checkDossier(SAMPLE, { txs: chain(SAMPLE), expectNonce: cv.SAMPLE_CHALLENGE.sample.nonce, issuedAtHeight: cv.SAMPLE_CHALLENGE.sample.height });
  const vg = cv.caseVerdict(withNonce, dossier);
  check("the sample with the nonce it answered and H0 4421300: green, Verified, with control", withNonce.assurance === "verified_with_control" && withNonce.controlled && vg.tone === "ok" && vg.headline === "Verified, with control" && /answers the nonce you issued, after height 4421300/.test(vg.sub), JSON.stringify(vg));
  check("SAMPLE_CHALLENGE is the sample's nonce, issued before its challenge was mined", cv.SAMPLE_CHALLENGE.sample.nonce === dossier.claims[11].nonce && cv.SAMPLE_CHALLENGE.sample.height < HEIGHTS["10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43"] && cv.SAMPLE_CHALLENGE.sample.network === dossier.network);
  const late = await checkDossier(SAMPLE, { txs: chain(SAMPLE), expectNonce: cv.SAMPLE_CHALLENGE.sample.nonce, issuedAtHeight: 4421400 });
  const vl = cv.caseVerdict(late, dossier);
  check("a control mined before H0: red, and the banner and the nonce line give the core's reason", vl.tone === "bad" && vl.headline === "1 claim failed" && /claim #12 \(control\): The challenge transaction 10e941e7…6e43 was mined at height 4421345, before you issued the nonce at height 4421400/.test(vl.sub) && (() => { const n = cv.nonceCheck(dossier, late, cv.SAMPLE_CHALLENGE.sample.nonce); return n.state === "match-unverified" && /mined at height 4421345, before you issued the nonce at height 4421400/.test(n.text); })(), vl.sub);
  const noControl = tamper((d) => { d.claims.pop(); });
  const vn = cv.caseVerdict(await checkDossier(noControl, { txs: chain(noControl) }), JSON.parse(noControl));
  check("no control claim: amber, and it says so", vn.tone === "partial" && vn.reason === "no-control" && /has no control claim/.test(vn.sub), JSON.stringify(vn));
  const unbound = tamper((d) => { d.claims[5].funded_by = []; });
  const ru = await checkDossier(unbound, { txs: chain(unbound) });
  const vu = cv.caseVerdict(ru, JSON.parse(unbound));
  check("a deposit with no funded_by is named in the subtitle", cv.unboundDeposits(ru, JSON.parse(unbound)).length === 1 && /Claim #6 \(deposit\), receipt r1 lists no funding notes: nothing ties that payment to the holder's other notes\./.test(vu.sub), vu.sub);
  const wrongNonce = tamper((d) => { d.claims[11].nonce = "zeceipt-challenge-00000000000000000000000000000000"; });
  const r2 = await checkDossier(wrongNonce, { txs: chain(wrongNonce) });
  const v2 = cv.caseVerdict(r2);
  check("a changed nonce: 1 claim failed, bad tone, the control row failed", v2.tone === "bad" && v2.headline === "1 claim failed" && r2.claims[11].status === "failed" && /does not carry the nonce/.test(r2.claims[11].summary), JSON.stringify(v2));
  const r3 = await checkDossier(SAMPLE, { txs: { ...chain(SAMPLE), "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43": { hex: hex("10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43"), height: null, mempool: true } } });
  const v3 = cv.caseVerdict(r3);
  check("a challenge in the mempool: Not all checked, pending tone", v3.tone === "pending" && v3.headline === "Not all checked" && /11 of 12 verified/.test(v3.sub), JSON.stringify(v3));
  const v4 = cv.caseVerdict(await checkDossier("{not json", {}));
  check("an unreadable dossier: bad, one plain sentence, the verifier's words kept for the detail", v4.tone === "bad" && v4.headline === "Not a readable dossier" && /^This is not valid JSON/.test(v4.sub) && /^not JSON/.test(v4.raw), JSON.stringify(v4));
  check("one claim reads as one", cv.caseVerdict({ all_verified: true, assurance: "verified_history_only", claims: [{ index: 0, kind: "origin", status: "verified" }] }).sub.startsWith("The claim holds against the chain (1 origin)"));
  check("a report without assurance is graded from all_verified and controlled", cv.caseVerdict({ all_verified: true, controlled: true, claims: [{ index: 0, kind: "control", status: "verified" }] }).headline === "Verified, with control");
}

// ---- the funds flow ----
{
  const payments = { r1: { recipient: "utest19q", value_zat: 1000000, memo: "INV-T-001" } };
  const steps = cv.flowSteps(dossier, report, { heights: HEIGHTS, payments });
  check("five steps, one per transaction, oldest first", steps.length === 5 && steps.every((s, i) => i === 0 || s.height >= steps[i - 1].height), steps.map((s) => s.height).join(" "));
  check("stages: origin, three hops, control", steps.map((s) => s.stage).join(" ") === "origin hop hop hop control", steps.map((s) => s.stage).join(" "));
  check("every claim is on one edge, and each edge carries its status", steps.flatMap((s) => s.edges.flatMap((e) => e.indices)).sort((a, b) => a - b).join() === "0,1,2,3,4,5,6,7,8,9,10,11" && steps.flatMap((s) => s.edges).every((e) => e.status === "verified"));
  check("path claims from one note in one transaction share an edge: 8 edges for 12 claims", steps.flatMap((s) => s.edges).length === 8 && steps[1].edges[0].label === "n1 → n2, n3, n4, n5 in fcfde625…7f0b" && cv.claimNumbers(steps[1].edges[0].indices) === "#2–#5" && steps[3].edges[0].label === "n3 → n7, n8 in a2619e39…3df8" && cv.claimNumbers(steps[3].edges[0].indices) === "#9, #10", JSON.stringify(steps[1].edges));
  check("claimNumbers", cv.claimNumbers([4, 1, 2, 3]) === "#2–#5" && cv.claimNumbers([0]) === "#1" && cv.claimNumbers([1, 3]) === "#2, #4");
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
  check("the case summary: headline, sha256, every claim, the scope", text.startsWith("Zeceipt case review: Claims verified — control not shown") && text.includes(report.dossier_sha256) && text.includes("12. Control, verified:") && text.includes("This does not prove:") && text.includes(nonce.text));
  const dl = cv.reportForDownload(report, { checkedAt: "t", nodes: ["n"], verifier: "v", nonce, generated: null });
  check("the downloaded report is the verifier's, with when and where it was checked", dl.version === "zeceipt-dossier-report-v1" && dl.dossier_sha256 === report.dossier_sha256 && dl.claims.length === 12 && dl.case.checked_at === "t" && dl.case.nodes[0] === "n" && dl.case.reviewer_nonce.state === "not-generated");
  check("the report's file name carries the dossier hash", cv.reportFileName(report) === `zeceipt-case-${report.dossier_sha256.slice(0, 12)}.json`);
  const dl2 = cv.reportForDownload(withNonceReport, { checkedAt: "t", nonce: cv.nonceCheck(dossier, withNonceReport, cv.SAMPLE_CHALLENGE.sample.nonce), issued: cv.SAMPLE_CHALLENGE.sample.nonce, wasmSha256: "ab".repeat(32), caseFields: { reviewer: " A. Reviewer ", caseId: "KYC-7", date: "" } });
  check("the downloaded report carries the nonce issued, H0, the wasm sha256 and the case fields", dl2.case.reviewer_nonce.state === "match" && dl2.case.reviewer_nonce.issued === cv.SAMPLE_CHALLENGE.sample.nonce && dl2.case.reviewer_nonce.issued_at_height === 4421300 && dl2.case.verifier_wasm_sha256 === "ab".repeat(32) && dl2.case.reviewer === "A. Reviewer" && dl2.case.case_id === "KYC-7" && dl2.case.case_date === null && dl2.issued_at_height === 4421300, JSON.stringify(dl2.case));
  const text2 = cv.caseSummaryText(dossier, withNonceReport, { caseFields: { reviewer: "A. Reviewer" }, wasmSha256: "ab".repeat(32) });
  check("the case summary: the graded headline, the case fields, the verifier and the decision summary", text2.startsWith("Zeceipt case review: Verified, with control\n") && text2.includes("\nReviewer: A. Reviewer\n") && text2.includes(`Verifier: zeceipt_wasm_bg.wasm sha256 ${"ab".repeat(32)}`) && text2.includes("- Under control: 0.2474375 TAZ. n4, spent in answer to your nonce at height 4421345 (issued at height 4421300).") && text2.includes("Nonce issued at height: 4421300"), text2);
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
  check("networkForKey: the prefix picks the network as the key is typed", bv.networkForKey(` ${UFVK}`).network === "test" && bv.networkForKey("uview1abc").network === "main" && bv.networkForKey("uviewtest1").network === "test" && bv.networkForKey("").network === null && bv.networkForKey("zxviews1").note === null);
  check("networkForKey: a regtest key is recognised, and not selected where the page offers no regtest", (() => { const r = bv.networkForKey("uviewregtest1abc"); return r.network === null && /command line/.test(r.note) && bv.networkForKey("uviewregtest1abc", ["main", "test", "regtest"]).network === "regtest"; })());

  const built = await buildDossier({ ufvk: UFVK, network: "test", hexes: TX.map(hex), controlHex: hex(CTL), control: { txid: CTL, nonce: NONCE } });
  const b = JSON.parse(built);
  check("the builder reproduces the sample from the published testnet UFVK", JSON.stringify([b.nk, b.notes, b.receipts, b.claims]) === JSON.stringify([dossier.nk, dossier.notes, dossier.receipts, dossier.claims]));
  const s = bv.dossierSummary(b, await checkDossier(built, { txs: chain(built) }));
  check("dossierSummary: 9 notes, 3 receipts, 12 claims, all verified", s.notes === 9 && s.receipts === 3 && s.claims === 12 && s.allVerified && s.counts[2][1] === "12 (1 origin, 7 path hops, 3 deposits and 1 control answer)", JSON.stringify(s.counts));
  check("dossierSummary: discloses nk, the openings and the receipts", s.discloses.length === 3 && /^nk, the nullifier key/.test(s.discloses[0]) && /^9 note openings/.test(s.discloses[1]) && /^3 sender receipts/.test(s.discloses[2]));
  check("dossierSummary: nk lets the reviewer watch future spends, and the advice after the case", /see when any of these notes is spent, now and after the case/.test(s.discloses[0]) && /move the remaining funds to a fresh account/.test(s.discloses[0]));

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
  check("landing page: the hero, both calls to action, the exchange sample, the receipt tools and GitHub", landing.includes("Prove where your shielded ZEC came from, without handing over your viewing key.") && landing.includes('href="case/">Review a dossier') && landing.includes('href="build/">Build a dossier') && landing.includes('href="case/#sample-exchange">Try a real exchange deposit review') && landing.includes('href="r/"') && landing.includes('href="demo/"') && landing.includes("https://github.com/beautifulrem/zeceipt"));
  check("landing page: the four claim lines are the case page's", Object.values(cv.KIND_BLURB).every((l) => landing.includes(l.replace("your nonce", "the reviewer's nonce"))));
  check("build page: the privacy promise, and the key field is never filled in by the browser", /Your viewing key stays in this page/.test(read(path.join(root, "build/index.html"))) && /<textarea id="ufvk"[^>]*spellcheck="false"[^>]*autocomplete="off"/.test(read(path.join(root, "build/index.html"))));
  check("the case page's sample is the fixture, byte for byte", read(path.join(root, "case", cv.SAMPLE_PATH)) === SAMPLE);
  check("the case page's exchange sample is the fixture, byte for byte", read(path.join(root, "case", cv.SAMPLES["sample-exchange"])) === read(path.join(repo, "fixtures/dossier/testnet-dossier-exchange.json")));
  check("the case page's transparent sample is the fixture, byte for byte", read(path.join(root, "case", cv.SAMPLES["sample-transparent"])) === read(path.join(repo, "fixtures/dossier/testnet-dossier-transparent-origin.json")));
  const buildHtml = read(path.join(root, "build/index.html"));
  check("build page: no 'oldest first' ordering asked of the holder; the verifier's sha256 and the after-the-case advice shown", !/oldest first|Order them by date/i.test(buildHtml) && /in any order/.test(buildHtml) && buildHtml.includes('id="wasm-sha"') && /After the case:/.test(buildHtml) && /see when any disclosed note is spent, now and later|When any disclosed note is spent, now and later/.test(buildHtml));
  const caseHtml = read(path.join(root, "case/index.html"));
  check("case page: the exchange review is the first sample offered", caseHtml.indexOf('id="sample-exchange"') < caseHtml.indexOf('id="sample"') && caseHtml.includes("Try a real exchange deposit review"));
  check("case page: nonce and H0 inputs, offline files, glossary, after the case, case fields, the verifier's sha256", ["nonce-input", "h0-input", "copy-challenge", "tx-files", "glossary", "after-card", "case-reviewer", "case-id", "case-date", "wasm-sha", "sample-nonce", "print-meta"].every((id) => caseHtml.includes(`id="${id}"`)) && ["Nullifier", "nk (nullifier key)", "Note", "Origin", "Path", "Control", "Not proven (unproven)", "Not checked yet (not_checked)"].every((t) => caseHtml.includes(`<dt>${t}</dt>`)), "");
  const site = read(path.join(repo, "scripts/build_site.sh"));
  check("build_site.sh publishes and checks the dossier pages", ["case/index.html", "case/page.js", "case/view.js", "case/ui.js", "case/case.css", "case/fixtures/testnet-dossier.json", "case/fixtures/testnet-dossier-transparent-origin.json", "case/fixtures/testnet-dossier-exchange.json", "build/index.html", "build/page.js", "build/view.js", "build/build.css", "home.css"].every((f) => site.includes(f)) && /cp "\$src\/index.html"/.test(site));
}


{
  // An origin whose note is never spent in the dossier is "not proven", not "not checked": waiting will not change it.
  const unproven = { claims: [{ index: 0, kind: "origin", status: "unproven", summary: "s" }, { index: 1, kind: "path", status: "verified", summary: "s" }], all_verified: false };
  const v = cv.caseVerdict(unproven);
  check("an unproven claim gives its own banner, not 'check again later'", v.tone === "pending" && v.headline === "1 claim not proven" && /Waiting will not change that/.test(v.sub) && cv.STATUS_LABEL.unproven === "Not proven", JSON.stringify(v));
  const problems = { claims: [{ index: 0, kind: "path", status: "verified", summary: "s" }], all_verified: false, problems: ["You issued a nonce, and no control claim answers it."] };
  check("a report-level problem is the banner's words", cv.caseVerdict(problems).sub.includes("no control claim answers it"));
}

// ---- the transparent sample: funds paid out to a transparent address, and back ----
{
  const VEC = JSON.parse(read(path.join(repo, "spec/test-vectors/dossier-v1.json")));
  const T = read(path.join(repo, "fixtures/dossier/testnet-dossier-transparent-origin.json"));
  const td = JSON.parse(T);
  const txs = {};
  for (const round of [0, 1]) for (const t of round === 0 ? dossierTxids(T) : dossierPrevoutTxids(T, txs)) txs[t] = { hex: hex(t), height: VEC.heights[t] ?? null };
  const tr = await checkDossier(T, { txs });
  const tv = cv.caseVerdict(tr, td);
  check("transparent sample: its unproven origin keeps the not-proven banner", tv.tone === "pending" && tv.headline === "1 claim not proven" && tr.claims[12].kind === "transparent_payment" && tr.claims[13].status === "unproven", JSON.stringify(tv));
  const rows = cv.claimRows(tr);
  check("transparent sample: the claim list names the transparent payment", rows[12].kindLabel === "Transparent payment" && rows[12].statusLabel === "Verified" && /tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu/.test(rows[12].summary) && cv.KIND_HELP.transparent_payment.length > 0);
  const steps = cv.flowSteps(td, tr, { heights: VEC.heights });
  const pay = steps.find((s) => s.payments.some((p) => p.transparent));
  check("transparent sample: seven steps, oldest first; the payment is a transparent paid-out step with its address and amount", steps.length === 7 && steps.every((s, i) => i === 0 || s.height >= steps[i - 1].height) && pay.txid === "52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e" && pay.title === "Moved within the wallet, and paid out (transparent)" && pay.payments[0].recipient === "tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu" && pay.payments[0].value === "0.05 TAZ" && pay.payments[0].id === "#13" && pay.spent.map((n) => n.id).join() === "n5" && pay.edges.some((e) => e.kind === "transparent_payment" && e.label === "n5 → tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu"), JSON.stringify(pay));
  check("stepTitle: a transaction that only pays a transparent address is Paid out (transparent)", cv.flowSteps({ network: "test", claims: [{ type: "transparent_payment", tx: "ab".repeat(32), output: 0, funded_by: ["n1"] }] }, { network: "test", notes: {}, claims: [{ index: 0, kind: "transparent_payment", status: "verified", value_zat: 5000000, paid_to: "tmX" }] })[0].title === "Paid out (transparent)");
  const back = steps.find((s) => s.funding.some((f) => f.note === "n10"));
  check("transparent sample: the returning origin says returned from claim #13 (paid by the holder)", back.funding[0].text === "From 1 transparent input (0.05 TAZ), paid from tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu; returned from claim #13 (paid by the holder)." && cv.returnedText([12]) === "returned from claim #13 (paid by the holder)", back.funding[0].text);
  const d = Object.fromEntries(cv.decisionSummary(td, tr).map((x) => [x.key, x]));
  check("decision summary: origins by source, payments including the transparent one, control, and claims by status", d["Arrived at origins"].value === "1.04985 TAZ in 2 notes" && /1\.0 TAZ from an undisclosed shielded sender and 0\.04985 TAZ returned from the holder's own transparent payment; not verified: n10 \(not proven\)/.test(d["Arrived at origins"].detail) && d["Paid out"].value === "0.11 TAZ in 4 payments" && d["Paid out"].detail === "3 shielded payments with a receipt (0.06 TAZ) and 1 transparent payment (0.05 TAZ)." && d["Under control"].value === "Not shown" && d.Claims.value === "14 verified · 1 not proven", JSON.stringify(d));
  const dg = Object.fromEntries(cv.decisionSummary(dossier, withNonceReport).map((x) => [x.key, x]));
  check("decision summary, the sample with its nonce: the value under control and its heights", dg["Under control"].value === "0.2474375 TAZ" && dg["Under control"].detail === "n4, spent in answer to your nonce at height 4421345 (issued at height 4421300)." && dg["Paid out"].value === "0.06 TAZ in 3 payments" && dg.Claims.value === "12 verified");
  check("kindBreakdown counts transparent payments", cv.kindBreakdown(tr.claims) === "2 origins, 8 path hops, 3 deposits, 1 control answer and 1 transparent payment");
}

// ---- the exchange deposit review: the flagship sample ----
{
  const X = read(path.join(repo, "fixtures/dossier/testnet-dossier-exchange.json"));
  const xd = JSON.parse(X);
  // The heights the testnet node reported (checked live on 2026-10-01).
  const XH = { "773da0147a8d0ba05f4bfe1e0a08a89dbfefda11b792172f7ebd71aeb56b4b0d": 4422275, "5146f38c0a782f0d76858e575c46c3b0908865987416095e4180a2c6273436e6": 4422279, a51d12711cd68729699ee93ea3e466bfb0222c7f3a02c2f64bd3b66ed60985cf: 4422295, "14a9551d4b85b05ce48dc6e83784bdb8bad0a68b6ec2a5e2298b2f77bb79cce6": 4422305 };
  const txs = {};
  for (const round of [0, 1]) for (const t of round === 0 ? dossierTxids(X) : dossierPrevoutTxids(X, txs)) txs[t] = { hex: hex(t), height: XH[t] ?? null };
  check("exchange sample: its four transactions, the hot wallet's funding among them", Object.keys(txs).sort().join() === Object.keys(XH).sort().join());
  const c = cv.SAMPLE_CHALLENGE["sample-exchange"];
  check("SAMPLE_CHALLENGE is per sample: the exchange's nonce at its H0, the others eadb… at 4421300", c.nonce === "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1" && c.height === 4422294 && c.nonce === xd.claims[3].nonce && cv.SAMPLE_CHALLENGE["sample-transparent"].nonce === cv.SAMPLE_CHALLENGE.sample.nonce && cv.SAMPLE_CHALLENGE["sample-transparent"].height === 4421300 && Object.keys(cv.SAMPLE_CHALLENGE).sort().join() === Object.keys(cv.SAMPLES).sort().join());
  const amber = await checkDossier(X, { txs });
  check("exchange sample without the nonce: amber", cv.caseVerdict(amber, xd).tone === "partial" && amber.assurance === "verified_history_only");
  const xr = await checkDossier(X, { txs, expectNonce: c.nonce, issuedAtHeight: c.height });
  const xv = cv.caseVerdict(xr, xd);
  check("exchange sample with the exchange's challenge: all 4 verified, Verified, with control", xr.assurance === "verified_with_control" && xv.tone === "ok" && xv.headline === "Verified, with control" && xr.claims.every((x) => x.status === "verified"), JSON.stringify(xv));
  const steps = cv.flowSteps(xd, xr, { heights: XH });
  check("exchange sample: the origin from the hot wallet, then the deposit to the exchange, then the control", steps.map((s) => s.stage).join(" ") === "origin hop control" && steps[0].funding[0].text === "From 1 transparent input (0.3 TAZ), paid from tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv." && steps[1].title === "Moved within the wallet, and paid out (transparent)" && steps[1].payments[0].recipient === "tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR" && steps[1].payments[0].value === "0.05 TAZ", JSON.stringify(steps.map((s) => [s.title, s.funding.map((f) => f.text)])));
  const d = Object.fromEntries(cv.decisionSummary(xd, xr).map((x) => [x.key, x]));
  check("exchange sample: the decision summary", d["Arrived at origins"].value === "0.2 TAZ in 1 note" && d["Arrived at origins"].detail === "0.2 TAZ from transparent inputs." && d["Paid out"].value === "0.05 TAZ in 1 payment" && d["Under control"].value === "0.14985 TAZ" && d["Under control"].detail === "n2, spent in answer to your nonce at height 4422305 (issued at height 4422294)." && d.Claims.value === "4 verified", JSON.stringify(d));
}

// ---- parse errors in plain words ----
{
  const VEC = JSON.parse(read(path.join(repo, "spec/test-vectors/dossier-v1.json")));
  const unknown = VEC.parse_cases.filter((c) => !cv.parseErrorText(c.expect.error).known).map((c) => c.name);
  check(`every parse error of the vectors (${VEC.parse_cases.length}) has a plain sentence`, unknown.length === 0, unknown.join(", "));
  check("no plain sentence shows serde's backticks, and each keeps the raw error", VEC.parse_cases.every((c) => { const p = cv.parseErrorText(c.expect.error); return !p.text.includes("`") && p.raw === c.expect.error; }));
  const say = (e) => cv.parseErrorText(e).text;
  check("parse errors: claims are numbered as the page numbers them (from 1)", say("dossier: claim 11 (control) lists note n4 twice") === "Claim #12 (control) lists note n4 twice: counted twice, it would inflate the amounts." && say("dossier: claim 12 (transparent_payment) names no funding note") === "Claim #13 (transparent payment) names no funding note: without one, nothing ties the payment to the holder.");
  check("parse errors: an unknown field, a claim type, a version, missing nk", /field, “holdings”,/.test(say("json: unknown field `holdings`, expected one of `version`")) && /claim of type “holding”/.test(say("json: unknown variant `holding`, expected one of `origin`, `path`")) && /“zeceipt-dossier-v2” file/.test(say('unsupported format version "zeceipt-dossier-v2"')) && /needs the nullifier key \(nk\)/.test(say("dossier: claim 1 (path) needs nk, which the dossier does not include")));
  check("parse errors: serde's own (missing field, wrong type, bad network, not JSON) and an unknown one", /“version”, is missing/.test(say("json: missing field `version` at line 1 column 2")) && /wrong kind of value/.test(say("json: invalid type: integer `5`, expected a string at line 1 column 111")) && /network, “x”,/.test(say("json: unknown variant `x`, expected one of `main`, `test`, `regtest` at line 1 column 45")) && /not valid JSON/.test(say("json: key must be a string at line 1 column 2")) && cv.parseErrorText("something new").known === false && cv.parseErrorText("Error: something new").raw === "something new");
  const real = await checkDossier(JSON.stringify({ ...dossier, holdings: [] }), { txs: {} });
  check("parse errors: a real verifier error maps", cv.caseVerdict(real).sub.startsWith("It has a field, “holdings”,") && /unknown field `holdings`/.test(cv.caseVerdict(real).raw));
}

// ---- the challenge record, heights, offline files ----
{
  check("heightInput: whole numbers only", cv.heightInput(" 4,421,300 ") === 4421300 && cv.heightInput("") === null && cv.heightInput("12.5") === null && cv.heightInput("0") === null && cv.heightInput("abc") === null);
  const rec = cv.challengeRecordText({ nonce: "zeceipt-challenge-00", height: 4421300, network: "test", issuedAt: "2026-09-30T12:40:05.000Z", now: "2026-09-30T13:00:00.000Z" });
  check("challengeRecordText: nonce, H0, the UTC time and the network", rec === "Zeceipt challenge (source-of-funds dossier)\nNonce: zeceipt-challenge-00\nIssued at height (H0): 4421300\nIssued: 2026-09-30 12:40 UTC\nNetwork: Zcash testnet", rec);
  check("challengeRecordText: a typed nonce is recorded at the copy's time", /Recorded: 2026-09-30 13:00 UTC \(the nonce was entered/.test(cv.challengeRecordText({ nonce: "n", height: null, network: "main", now: "2026-09-30T13:00:00.000Z" })));
  const t0 = "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b";
  check("txFile: <txid>.hex, hex inside; anything else is named and skipped", cv.txFile(`${t0.toUpperCase()}.hex`, " ABcd\n").txid === t0 && cv.txFile(`${t0}.hex`, "abcd\n").hex === "abcd" && /not named/.test(cv.txFile("tx.hex", "ab").error) && /not a transaction in hex/.test(cv.txFile(`${t0}.hex`, "xyz").error) && /not a transaction in hex/.test(cv.txFile(`${t0}.txt`, "abc").error));
  const files = Object.fromEntries(dossierTxids(SAMPLE).map((t) => [t, { hex: hex(t), height: null, mempool: false }]));
  const off = await checkDossier(SAMPLE, { txs: files, expectNonce: cv.SAMPLE_CHALLENGE.sample.nonce });
  const facts = Object.fromEntries(cv.caseFacts(dossier, off, { checkedAt: "2026-09-30T12:56:00.000Z", offline: 5 }));
  check("offline from files: the claims verify, each notes inclusion was not checked, and the facts say so", off.all_verified && off.claims.every((c) => (c.details ?? []).some((x) => /Loaded without a height/.test(x))) && facts.Checked === "2026-09-30 12:56 UTC, offline, from 5 transaction files: no node was asked, so inclusion in the chain (and each height) was not checked", facts.Checked);
  check("offline: the timeline keeps the dossier's order without heights", cv.flowSteps(dossier, off, {}).map((s) => s.stage).join(" ") === "origin hop hop hop control");
}

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
