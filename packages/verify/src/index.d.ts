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
/** A `zdp:1:` delivery proof (zcash-delivery-proof's format), as `parseReceipt` reads it; it names no network. */
export interface DeliveryProofInfo {
  kind: "delivery-proof";
  network: null;
  txid: string;
  pool: "ironwood" | "orchard";
  output_index: number;
  value_zat: number;
}
export interface VerifyResult {
  valid: boolean;
  /** "receipt" for a zeceipt receipt, "delivery-proof" for a `zdp:1:` proof. */
  kind: "receipt" | "delivery-proof";
  stage?: "parse" | "tx" | "txid" | "signature" | "challenge" | "output" | "recovery" | "other";
  error?: string;
  txid?: string;
  /** ZIP 239 wtxid, hex (txid then authorizing-data digest, internal byte order). */
  wtxid?: string;
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
/**
 * Load the WASM verifier once; returns its version. In a browser, no argument fetches `pkg/zeceipt_wasm_bg.wasm` next to
 * the module. In Node, pass the bytes (Node's fetch cannot read a `file:` URL).
 */
export function initVerifier(wasm?: string | URL | Response | BufferSource | WebAssembly.Module): Promise<string>;
export function parseReceipt(input: string): Receipt | DeliveryProofInfo;
export function isDeliveryProof(input: string): boolean;
export function checkSignature(receipt: string): { signed: boolean; valid: boolean; issuer_pubkey?: string; error?: string };
export function verifyReceipt(receipt: string, rawTxHex: string, opts?: { challenge?: string; requireSignature?: boolean; network?: Network }): VerifyResult;
export const GRPC_WEB_ENDPOINTS: { main: string[]; test: string[] };
/** Use your own gRPC-web nodes per network (https, or http on localhost); later fetches ask only these. */
export function useNodes(nodes: { main?: string[]; test?: string[] }): { main: string[]; test: string[] };
/** fetchRawTx over several networks, for a proof that names none: a node's "not found" moves on to the next network. */
export function fetchRawTxAnyNetwork(txidDisplayHex: string, networks?: Network[], opts?: { timeoutMs?: number }): Promise<{ hex: string; height: number | null; chain: { status: "mined" | "mempool" | "fork"; height?: number }; endpoint: string; network: Network }>;
/** The outcome of an issuer-binding lookup (spec §7); never a verdict on the receipt's validity. */
export type IssuerBinding = { state: "confirmed" | "not_listed"; domain: string } | { state: "unknown"; reason: string };
export function issuerClaim(receipt: string): { claim: { label: string; domain: string; url: string } } | { binding: IssuerBinding };
export const MAX_WELL_KNOWN_BYTES: number;
export function checkIssuerBinding(receipt: string, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<IssuerBinding>;
/** The node's view of the transaction, from lightwalletd's `RawTransaction.height` sentinels. */
export type ChainStatus = { status: "mined"; height: number } | { status: "mempool" } | { status: "fork" };
export function chainStatus(height: bigint | null): ChainStatus;
/**
 * Throws when `network` has no public endpoint (regtest) and none are passed. When no node has the
 * transaction (gRPC code 5, a "not found"/"no such" message, or empty data), the error has
 * `code: "not_found"`, and it wins over another node being unreachable.
 */
/** Each endpoint gets `timeoutMs` (default 20 000) before the next is tried. */
export function fetchRawTx(txidDisplayHex: string, network?: Network, endpoints?: string[], options?: { timeoutMs?: number }): Promise<{ hex: string; height: number | null; chain: ChainStatus; endpoint: string }>;
/** The chain tip over gRPC-web (`GetLatestBlock`), from the same endpoints and with the same failover as `fetchRawTx`. */
export function fetchChainTip(network?: Network, endpoints?: string[], options?: { timeoutMs?: number }): Promise<{ height: number; endpoint: string }>;
/** Confirmations of a transaction mined at `height` with the tip at `tip` (`tip - height + 1`, Zcash's convention); null when unknown or the tip is below the height. */
export function confirmations(height: number | null, tip: number | null): number | null;

/** A source-of-funds dossier check's outcome (`zeceipt-dossier-report-v1`); see spec/dossier-v1.md. */
export interface DossierReport {
  version: "zeceipt-dossier-report-v1";
  network: Network;
  subject?: string;
  dossier_sha256: string;
  nk_proven: boolean;
  controlled: boolean;
  problems?: string[];
  notes: Record<string, { txid: string; pool: string; action: number; height?: number; recipient?: string; value_zat?: number; memo?: string; nullifier?: string; spent_in?: string; error?: string }>;
  claims: { index: number; kind: "origin" | "path" | "deposit" | "control" | "transparent_payment"; status: "verified" | "failed" | "not_checked" | "unproven"; summary: string; details?: string[]; value_zat?: number; paid_to?: string; funding?: { transparent_inputs: { prevout: string; address?: string; value_zat?: number; paid_in_claim?: number }[]; shielded_actions: number; sapling_spends: number; from_disclosed: string[] } }[];
  all_verified: boolean;
  assurance: "verified_with_control" | "verified_history_only" | "not_verified";
  issued_at_height?: number;
  disclosed: string[];
  does_not_prove: string[];
  error?: string;
  stage?: string;
}
export function checkDossier(text: string, opts?: { txs?: Record<string, { hex: string; height: number | null; mempool?: boolean }>; expectNonce?: string; issuedAtHeight?: number | null; timeoutMs?: number; onFetch?: (p: { txid: string; index: number; total: number; round: number }) => void }): Promise<DossierReport>;
export function dossierTxids(text: string): string[];
/** The second round's txids: the transactions whose outputs the origin transactions in `txs` spend. */
export function dossierPrevoutTxids(text: string, txs: Record<string, { hex: string; height: number | null; mempool?: boolean }>): string[];
export function buildDossier(opts: { ufvk: string; network?: Network; txids?: string[]; hexes?: string[]; control?: { txid: string; nonce: string } | null; controlHex?: string | null; subject?: string | null; timeoutMs?: number }): Promise<string>;
/** Find the holder's transactions in a height range, in the page (the UFVK never leaves it). */
export function scanWallet(opts: { ufvk: string; network?: Network; from: number; to?: number | null; endpoints?: string[]; chunk?: number; timeoutMs?: number; onProgress?: (p: { height: number; from: number; to: number; found: number }) => void; signal?: AbortSignal }): Promise<{ height: number; txid: string; received: number; spent: number }[]>;
