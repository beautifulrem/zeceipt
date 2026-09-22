// Automatic receipt issuance after confirmation (REQ-CON-11). Runs the `zeceipt` CLI (the wasm binding
// replaces this later), restricted to the batch's own recipients (`--only-to`, RSK-20), then cross-checks
// every receipt against the batch item it should prove and verifies it before returning anything.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  /** Challenge bound into every receipt and required at verification. */
  challenge: string;
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
 * Returns `waiting` below the threshold. Throws (and returns nothing) if the receipts do not match the
 * batch exactly or any receipt fails verification.
 */
export async function autoIssue(args: {
  batch: Batch;
  txid: string;
  status: TxStatus;
  requiredConfirmations: number;
  cli: ZeceiptCliOptions;
  /** Directory to write the receipt JSON files into (optional). */
  outDir?: string;
}): Promise<AutoIssueResult> {
  const { batch, txid, status, requiredConfirmations, cli } = args;
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
    "--challenge", cli.challenge,
    "--label", `batch ${batch.id}`,
    ...batch.items.flatMap((i) => ["--only-to", i.address]),
    ...(args.outDir ? ["--out-dir", args.outDir] : []),
  ];
  const issued = await zeceipt(cli, issueArgs);
  if (issued.code !== 0) {
    throw new IssuanceMismatchError([`zeceipt issue exited ${issued.code}: ${issued.stderr.trim() || issued.stdout.trim()}`]);
  }
  const out = JSON.parse(issued.stdout) as {
    height: number | null;
    receipts: { receipt: Record<string, unknown>; url: string; recovered: RecoveredOutput }[];
    skipped_not_in_allow_list: number;
  };
  if ((out.receipts[0]?.receipt.txid as string | undefined) !== undefined && out.receipts.some((r) => r.receipt.txid !== txid)) {
    throw new IssuanceMismatchError([`receipts are for another transaction than ${txid}`]);
  }

  // Cross-check: exactly one receipt per item, matched by memo, same value, never change.
  const problems: string[] = [];
  const used = new Set<number>();
  const pairs: { item: (typeof batch.items)[number]; r: (typeof out.receipts)[number] }[] = [];
  for (const item of batch.items) {
    const hits = out.receipts.filter((r) => r.recovered.memo.kind === "text" && r.recovered.memo.text === item.memo);
    if (hits.length !== 1) {
      problems.push(`payable ${item.payableId} (memo ${JSON.stringify(item.memo)}): ${hits.length} receipts`);
      continue;
    }
    const r = hits[0];
    if (decimalToZat(r.recovered.value_zec) !== item.zat) problems.push(`payable ${item.payableId}: value ${r.recovered.value_zec} ≠ ${item.zat} zat`);
    if (r.recovered.is_change !== false) problems.push(`payable ${item.payableId}: output ${r.recovered.index} is change or unknown (${r.recovered.is_change})`);
    used.add(r.recovered.index);
    pairs.push({ item, r });
  }
  const extra = out.receipts.filter((r) => !used.has(r.recovered.index));
  if (extra.length) problems.push(`${extra.length} receipt(s) for outputs not in the batch: indexes ${extra.map((r) => r.recovered.index).join(", ")}`);
  if (problems.length) throw new IssuanceMismatchError(problems);

  // Verify each receipt exactly as a recipient would (signature + challenge required).
  const dir = await mkdtemp(join(tmpdir(), "zeceipt-verify-"));
  try {
    const receipts: IssuedReceipt[] = [];
    for (const { item, r } of pairs) {
      const f = join(dir, `${item.payableId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
      await writeFile(f, JSON.stringify(r.receipt), { mode: 0o600 });
      const v = await zeceipt(cli, ["verify", ...netFlags(batch), ...(cli.rawTxFile ? ["--raw-tx-file", cli.rawTxFile] : ["--endpoint", cli.endpoint!]), f, "--challenge", cli.challenge, "--require-signature"]);
      let valid = false;
      try {
        valid = v.code === 0 && JSON.parse(v.stdout).valid === true;
      } catch {
        valid = false;
      }
      if (!valid) throw new ReceiptVerificationError(item.payableId, v.stdout.trim() || v.stderr.trim());
      receipts.push({ payableId: item.payableId, outputIndex: r.recovered.index, receipt: r.receipt, url: r.url, recovered: r.recovered, verified: true });
    }
    return { state: "issued", txid, height: out.height ?? status.height, receipts, skippedNotInAllowList: out.skipped_not_in_allow_list };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
