// Automatic receipt issuance after confirmation (REQ-CON-11). Runs the `zeceipt` CLI (the wasm binding
// replaces this later), restricted to the batch's own recipients (`--only-to`, RSK-20), then cross-checks
// every receipt against the batch item it should prove and verifies it before returning anything.

import { execFile, spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { decimalToZat } from "../execution/money.ts";
import type { Batch, TxStatus } from "../execution/types.ts";
import { ExecutionError } from "../execution/types.ts";

const run = promisify(execFile);

export interface ZeceiptCliOptions {
  /** Path to the `zeceipt` binary. */
  bin: string;
  /** lightwalletd/Zaino endpoint; omit to use `rawTxFile` (offline). */
  endpoint?: string;
  /** Raw transaction hex file (offline mode, tests). */
  rawTxFile?: string;
  /** File holding the issuer's UFVK (never passed on argv). */
  ufvkFile: string;
  /** Issuer signing key from `zeceipt keygen`. */
  keyFile: string;
  keyId: string;
  /**
   * Verifier-issued challenge bound into every receipt and required at verification (ZIP 311 `msg`;
   * THREAT_MODEL: interactive proofs). The console omits it: its receipts are bearer links for recipients
   * (slice D3). Without one, `issue` binds none and `verify` requires the receipt to carry none.
   */
  challenge?: string;
  timeoutMs?: number;
}

export interface RecoveredOutput {
  pool: string;
  index: number;
  recipient: string;
  value_zat: number;
  value_zec: string;
  memo: { kind: string; text?: string; hex?: string };
  is_change: boolean | null;
}

interface IssueOutput {
  receipt: Record<string, unknown>;
  url: string;
  recovered: RecoveredOutput;
  /** The `--only-to` entries this output pays (receiver-level match, reported by the CLI). */
  matched_only_to: string[];
}

export interface IssuedReceipt {
  payableId: string;
  outputIndex: number;
  receipt: Record<string, unknown>;
  url: string;
  recovered: RecoveredOutput;
  verified: true;
}

export type AutoIssueResult =
  | { state: "waiting"; confirmations: number; required: number }
  | { state: "issued"; txid: string; height: number; receipts: IssuedReceipt[]; skippedNotInAllowList: number };

export class IssuanceMismatchError extends ExecutionError {
  readonly details: string[];
  constructor(details: string[]) {
    super("issuance_mismatch", `issued receipts do not match the batch: ${details.join("; ")}`);
    this.details = details;
  }
}

export class ReceiptVerificationError extends ExecutionError {
  constructor(payableId: string, detail: string) {
    super("receipt_unverified", `receipt for payable ${payableId} failed verification: ${detail}`);
  }
}

function netFlags(batch: Batch): string[] {
  return batch.network === "main" ? [] : batch.network === "test" ? ["--testnet"] : ["--regtest"];
}

function sourceFlags(cli: ZeceiptCliOptions, txid: string): string[] {
  if (cli.rawTxFile) return ["--raw-tx-file", cli.rawTxFile];
  if (!cli.endpoint) throw new Error("either endpoint or rawTxFile is required");
  return ["--endpoint", cli.endpoint, "--txid", txid];
}

/**
 * Run `zeceipt` with `input` on stdin (no shell, bounded output, timeout). Used for `verify -`, so a receipt
 * (which contains an OCK) is never written to a file.
 */
function zeceiptStdin(cli: ZeceiptCliOptions, args: string[], input: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli.bin, args, { stdio: ["pipe", "pipe", "pipe"], timeout: cli.timeoutMs ?? 120_000 });
    let stdout = "";
    let stderr = "";
    const limit = 16 * 1024 * 1024;
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      if (stdout.length > limit) child.kill();
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
      if (stderr.length > limit) child.kill();
    });
    child.on("error", (e) => reject(new Error(`running ${cli.bin} failed: ${e.message}`)));
    child.on("close", (code, signal) => (code === null ? reject(new Error(`running ${cli.bin} failed: ${signal ?? "killed"}`)) : resolve({ code, stdout, stderr })));
    child.stdin.on("error", () => {}); // the child may exit before reading everything; its exit code decides
    child.stdin.end(input);
  });
}

async function zeceipt(cli: ZeceiptCliOptions, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(cli.bin, args, { timeout: cli.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; message: string };
    if (typeof err.code === "number") return { code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    throw new Error(`running ${cli.bin} failed: ${err.message}`);
  }
}

/**
 * Issue one receipt per batch item once the payment has `requiredConfirmations`.
 * Returns `waiting` below the threshold. Throws — and returns and writes nothing — if the receipts do not
 * match the batch exactly or any receipt fails verification. Receipt files go to `outDir` only after
 * every receipt has passed.
 */
export async function autoIssue(args: {
  batch: Batch;
  txid: string;
  status: TxStatus;
  requiredConfirmations: number;
  cli: ZeceiptCliOptions;
  /** Tools and the regtest proof only: also write each receipt (it contains an OCK) as a 0600 file here. The console never sets this. */
  outDir?: string;
}): Promise<AutoIssueResult> {
  const { batch, txid, status, requiredConfirmations, cli } = args;
  // Matching is by memo, so memos must be present and unique (preflight enforces the same rules).
  const invalid: string[] = [];
  const memos = new Set<string>();
  const payables = new Set<string>();
  for (const it of batch.items) {
    if (it.memo === "") invalid.push(`payable ${it.payableId}: empty memo`);
    else if (memos.has(it.memo)) invalid.push(`memo ${JSON.stringify(it.memo)} appears twice`);
    if (payables.has(it.payableId)) invalid.push(`payable ${it.payableId} appears twice`);
    memos.add(it.memo);
    payables.add(it.payableId);
  }
  if (batch.items.length === 0) invalid.push("batch has no items");
  if (invalid.length) throw new IssuanceMismatchError(invalid);
  if (status.state !== "mined") {
    return { state: "waiting", confirmations: 0, required: requiredConfirmations };
  }
  if (status.confirmations < requiredConfirmations) {
    return { state: "waiting", confirmations: status.confirmations, required: requiredConfirmations };
  }

  const issueArgs = [
    "issue",
    ...netFlags(batch),
    ...sourceFlags(cli, txid),
    "--ufvk-file", cli.ufvkFile,
    "--key-file", cli.keyFile,
    "--key-id", cli.keyId,
    ...(cli.challenge === undefined ? [] : ["--challenge", cli.challenge]),
    "--label", `batch ${batch.id}`,
    ...batch.items.flatMap((i) => ["--only-to", i.address]),
  ];
  const issued = await zeceipt(cli, issueArgs);
  if (issued.code !== 0) {
    throw new IssuanceMismatchError([`zeceipt issue exited ${issued.code}: ${issued.stderr.trim() || issued.stdout.trim()}`]);
  }
  const out = JSON.parse(issued.stdout) as { height: number | null; receipts: IssueOutput[]; skipped_not_in_allow_list: number };
  const problems: string[] = [];
  if (out.receipts.some((r) => r.receipt.txid !== txid)) problems.push(`receipts are for another transaction than ${txid}`);
  if (out.height !== null && out.height !== status.height) problems.push(`the chain places ${txid} at height ${out.height}, status said ${status.height}`);

  // Cross-check: exactly one receipt per item, matched by memo; it pays that item's own address, with the
  // same value, and is not change; no output is claimed twice; no receipt is left over.
  const outputKey = (r: IssueOutput) => `${r.recovered.pool}:${r.recovered.index}`;
  const used = new Set<string>();
  const pairs: { item: (typeof batch.items)[number]; r: IssueOutput }[] = [];
  for (const item of batch.items) {
    const hits = out.receipts.filter((r) => r.recovered.memo.kind === "text" && r.recovered.memo.text === item.memo);
    if (hits.length !== 1) {
      problems.push(`payable ${item.payableId} (memo ${JSON.stringify(item.memo)}): ${hits.length} receipts`);
      continue;
    }
    const r = hits[0];
    if (!r.matched_only_to?.includes(item.address)) problems.push(`payable ${item.payableId}: output ${outputKey(r)} pays ${r.recovered.recipient}, not this payable's address`);
    if (decimalToZat(r.recovered.value_zec) !== item.zat) problems.push(`payable ${item.payableId}: value ${r.recovered.value_zec} ≠ ${item.zat} zat`);
    if (r.recovered.is_change !== false) problems.push(`payable ${item.payableId}: output ${outputKey(r)} is change or unknown (${r.recovered.is_change})`);
    if (used.has(outputKey(r))) problems.push(`payable ${item.payableId}: output ${outputKey(r)} is already claimed by another payable`);
    used.add(outputKey(r));
    pairs.push({ item, r });
  }
  const extra = out.receipts.filter((r) => !used.has(outputKey(r)));
  if (extra.length) problems.push(`${extra.length} receipt(s) for outputs not in the batch: ${extra.map(outputKey).join(", ")}`);
  if (problems.length) throw new IssuanceMismatchError(problems);

  // Verify each receipt exactly as a recipient would (signature required; the challenge, if one was bound). The receipt goes to
  // `zeceipt verify -` on stdin: it contains the output's OCK and is never written to a file here.
  {
    const receipts: IssuedReceipt[] = [];
    for (const { item, r } of pairs) {
      const v = await zeceiptStdin(cli, ["verify", ...netFlags(batch), ...(cli.rawTxFile ? ["--raw-tx-file", cli.rawTxFile] : ["--endpoint", cli.endpoint!]), "-", ...(cli.challenge === undefined ? [] : ["--challenge", cli.challenge]), "--require-signature"], JSON.stringify(r.receipt));
      let valid = false;
      try {
        valid = v.code === 0 && JSON.parse(v.stdout).valid === true;
      } catch {
        valid = false;
      }
      if (!valid) throw new ReceiptVerificationError(item.payableId, v.stdout.trim() || v.stderr.trim());
      receipts.push({ payableId: item.payableId, outputIndex: r.recovered.index, receipt: r.receipt, url: r.url, recovered: r.recovered, verified: true });
    }
    if (args.outDir) {
      // Tools and the regtest proof only — the console never passes outDir; it stores receipts sealed
      // (`recordReceipts`). Files hold OCKs, so they are owner-only (0600) in an owner-only directory.
      await mkdir(args.outDir, { recursive: true, mode: 0o700 });
      for (const x of receipts) {
        const name = `${txid.slice(0, 16)}-${x.recovered.pool}-${x.recovered.index}.json`;
        const tmp = join(args.outDir, `.${name}.tmp`);
        await writeFile(tmp, JSON.stringify(x.receipt, null, 2), { mode: 0o600 });
        await rename(tmp, join(args.outDir, name));
      }
    }
    return { state: "issued", txid, height: out.height ?? status.height, receipts, skippedNotInAllowList: out.skipped_not_in_allow_list };
  }
}
