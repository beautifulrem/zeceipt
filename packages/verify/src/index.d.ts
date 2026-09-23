export type Network = "main" | "test" | "regtest";
export interface Receipt {
  version: "zeceipt-v0";
  network: Network;
  pool: "ironwood" | "orchard" | "sapling";
  txid: string;
  output_index: number;
  ock: string;
  label: string;
  challenge?: string;
  issuer_key_id?: string;
  issuer_pubkey?: string;
  signature?: string;
  zip311_profile?: string;
}
export interface VerifyResult {
  valid: boolean;
  stage?: "parse" | "tx" | "txid" | "signature" | "challenge" | "output" | "recovery" | "other";
  error?: string;
  txid?: string;
  pool?: string;
  output_index?: number;
  recipient?: string;
  value_zat?: number;
  value_zec?: string;
  memo?: { kind: "empty" | "text" | "bytes"; text?: string; hex?: string };
  label?: string;
  issuer_pubkey?: string;
  issuer_key_id?: string;
  challenge_checked: boolean;
  proves: string;
  does_not_prove: string;
}
export function initVerifier(wasmUrl?: string | URL): Promise<string>;
export function parseReceipt(input: string): Receipt;
export function checkSignature(receipt: string): { signed: boolean; valid: boolean; issuer_pubkey?: string; error?: string };
export function verifyReceipt(receipt: string, rawTxHex: string, opts?: { challenge?: string; requireSignature?: boolean }): VerifyResult;
export const GRPC_WEB_ENDPOINTS: { main: string[]; test: string[] };
/** The node's view of the transaction, from lightwalletd's `RawTransaction.height` sentinels. */
export type ChainStatus = { status: "mined"; height: number } | { status: "mempool" } | { status: "fork" };
export function chainStatus(height: bigint | null): ChainStatus;
/**
 * Throws when `network` has no public endpoint (regtest) and none are passed. When no node has the
 * transaction (gRPC code 5, a "not found"/"no such" message, or empty data), the error has
 * `code: "not_found"`, and it wins over another node being unreachable.
 */
export function fetchRawTx(txidDisplayHex: string, network?: Network, endpoints?: string[]): Promise<{ hex: string; height: number | null; chain: ChainStatus; endpoint: string }>;
