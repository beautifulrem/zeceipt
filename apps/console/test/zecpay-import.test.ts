// The zecpay import plan (slice I3a; REQ-CON-19; `05` §3.6). `fixtures/zecpay-sample-payroll.csv` is zecpay's own
// sample, `public/sample-payroll.csv` from Spider333/zecpay at b8a9115 (MIT licence, R112), unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dollarsToCents, parseZecpayCsv, planZecpayImport, type PlanContext } from "../lib/import/zecpay.ts";

const SAMPLE = readFileSync(new URL("./fixtures/zecpay-sample-payroll.csv", import.meta.url), "utf8");
// Regtest unified addresses with Orchard receivers (the committed Zkool fixture's recipients, as in receipt-routes.test.ts).
const UA = [
  "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w",
  "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj",
  "uregtest17mjv2tq2m6xpyurrqnvsc5rva5ypshg8tr0v9cd0w59vxt2e0rrxhf592457hg939efj3tw9a8u4u0ct3h5nyrxpjwj9wj3hecrk5pt5",
];
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ network: "regtest", kind: "salary", prefix: "PAYROLL-2026-09", recipients: [], takenReferences: new Set(), ...over });

test("zecpay's own sample on mainnet: all five rows refused, each with its reason, nothing planned", () => {
  const plan = planZecpayImport(parseZecpayCsv(SAMPLE), ctx({ network: "main" }));
  assert.equal(plan.payables.length, 0);
  assert.deepEqual(plan.refused.map((r) => r.sourceLine), [2, 3, 4, 5, 6]);
  for (const r of plan.refused.slice(0, 3)) assert.match(r.reason, /^not an address this console pays: expected a main unified address \(u1…\), got prefix "zs"/, `line ${r.sourceLine}: Sapling`);
  assert.match(plan.refused[3].reason, /^not an address this console pays: Bech32m checksum does not verify/, "Dave's u1… is not a valid unified address");
  assert.match(plan.refused[4].reason, /^the amount is in ZEC/, "Eve: currency ZEC is checked first");
});

test("valid rows: USD amounts in whole cents, a new recipient per receiver, references from the prefix and the source line", () => {
  const csv = `name,wallet,amount,currency,payout_currency\nAlice,${UA[0]},500,USD,ZEC\nBob,${UA[1]},227.5,,\nAlice again,${UA[0]},0.05,usd,zec`;
  const plan = planZecpayImport(parseZecpayCsv(csv), ctx());
  assert.deepEqual(plan.refused, []);
  assert.deepEqual(plan.payables.map((p) => [p.sourceLine, p.usdCents, p.reference, p.recipient]), [
    [2, 50000, "PAYROLL-2026-09-2", { kind: "new", name: "Alice" }],
    [3, 22750, "PAYROLL-2026-09-3", { kind: "new", name: "Bob" }],
    [4, 5, "PAYROLL-2026-09-4", { kind: "new", name: "Alice" }],
  ], "defaults USD and ZEC; a second row to the same receiver shares the first row's new recipient and name");
});

test("recipients match by Orchard receiver, not by the address text; the existing name is kept and the file's is shown", () => {
  const csv = `name,wallet,amount\nA. Smith,${UA[0].toUpperCase()},10`;
  const plan = planZecpayImport(parseZecpayCsv(csv), ctx({ recipients: [{ id: "r-1", displayName: "Alice Smith", address: UA[0], network: "regtest" }] }));
  assert.deepEqual(plan.payables.map((p) => p.recipient), [{ kind: "existing", id: "r-1", name: "Alice Smith", fileName: "A. Smith" }], "the upper-case encoding is the same receiver");
  assert.equal(plan.payables[0].address, UA[0], "stored lower-cased, as the recipient form stores it");
  const mixed = planZecpayImport(parseZecpayCsv(`name,wallet,amount\nA,${UA[0].slice(0, 20)}${UA[0].slice(20).toUpperCase()},10`), ctx());
  assert.match(mixed.refused[0].reason, /mixes upper and lower case/);
  const other = planZecpayImport(parseZecpayCsv(csv), ctx({ recipients: [{ id: "r-2", displayName: "Main", address: UA[0], network: "main" }] }));
  assert.equal(other.payables[0].recipient.kind, "new", "a recipient on another network is not a match");
});

test("each refusal in §3.6's order, one reason per row", () => {
  const csv = [
    "name,wallet,amount,currency,payout_currency",
    `A,${UA[0]},10,ZEC,USDC`, // currency first
    `B,${UA[0]},10,EUR,ZEC`,
    `C,${UA[0]},10,USD,USDC`, // then payout (any value but ZEC: zecpay's code does not check it)
    `D,zs1abc,1.005,USD,ZEC`, // then amount, before the address
    `E,zs1abc,10,USD,ZEC`, // then address
    `,${UA[2]},10,USD,ZEC`, // a new recipient without a name
  ].join("\n");
  const plan = planZecpayImport(parseZecpayCsv(csv), ctx());
  assert.deepEqual(plan.refused.map((r) => [r.sourceLine, r.reason.split(":")[0]]), [
    [2, "the amount is in ZEC"],
    [3, "currency must be USD or ZEC, not 'EUR'"],
    [4, "the console pays only ZEC, not 'USDC'"],
    [5, "invalid amount '1.005'"],
    [6, "not an address this console pays"],
    [7, "a new recipient needs a name"],
  ]);
});

test("a taken reference is refused per row as 'reference taken'; the limit is 50 payables", () => {
  const csv = `name,wallet,amount\nA,${UA[0]},1\nB,${UA[1]},2`;
  const plan = planZecpayImport(parseZecpayCsv(csv), ctx({ takenReferences: new Set(["PAYROLL-2026-09-3"]) }));
  assert.deepEqual(plan.refused, [{ sourceLine: 3, reason: "reference taken: PAYROLL-2026-09-3 is already a payable's reference" }]);
  const many = ["name,wallet,amount", ...Array.from({ length: 52 }, () => `A,${UA[0]},1`)].join("\n");
  const big = planZecpayImport(parseZecpayCsv(many), ctx());
  assert.equal(big.payables.length, 50);
  assert.deepEqual(big.refused.map((r) => r.sourceLine), [52, 53]);
});

test("file-level problems: no header, no prefix, a prefix that cannot make a reference", () => {
  assert.match(planZecpayImport(parseZecpayCsv(`Alice,${UA[0]},10`), ctx()).fileProblem!, /zecpay's header/);
  assert.match(planZecpayImport(parseZecpayCsv("name,wallet,amount"), ctx({ prefix: "  " })).fileProblem!, /give a reference prefix/);
  assert.match(planZecpayImport(parseZecpayCsv("name,wallet,amount"), ctx({ prefix: "BAD​PREFIX" })).fileProblem!, /cannot make a valid reference/);
  assert.equal(planZecpayImport(parseZecpayCsv(""), ctx()).fileProblem, "the file is empty");
});

test("amounts are whole cents, stricter than zecpay's parseFloat", () => {
  const cases: [string, number | undefined][] = [["500", 50000], ["227.5", 22750], ["227.50", 22750], ["0.05", 5], ["500abc", undefined], ["1.005", undefined], ["-5", undefined], ["1e3", undefined], ["", undefined]];
  for (const [amount, want] of cases) assert.equal(dollarsToCents(amount), want, amount);
});
