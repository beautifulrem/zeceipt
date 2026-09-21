export interface Receipt {
  version: "zeceipt-v0";
  network: "main" | "test";
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
export function verifyReceipt(receipt: string, rawTxHex: string, opts?: { challenge?: string; requireSignature?: boolean }): VerifyResult;
export const GRPC_WEB_ENDPOINTS: { main: string[]; test: string[] };
export function fetchRawTx(txidDisplayHex: string, network?: "main" | "test", endpoints?: string[]): Promise<{ hex: string; height: number | null; endpoint: string }>;
