/* tslint:disable */
/* eslint-disable */

/**
 * A wallet scan in the browser (the dossier builder's "find my transactions"): made from the holder's UFVK, which stays
 * in the page, it is fed serialized `CompactBlock`s from a gRPC-web `GetBlockRange` stream and reports the holder's
 * transactions (`zeceipt_core::dossier::WalletScanner`).
 */
export class DossierScanner {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The holder's transactions found so far: `[{ height, txid, received, spent }]`, in chain order.
     */
    found(): any;
    constructor(ufvk: string, network: string);
    /**
     * Scan one serialized `CompactBlock`; returns its height.
     */
    scan_block(block: Uint8Array): bigint;
}

/**
 * Build a dossier in the browser from the holder's UFVK (it never leaves the page) and the raw transactions of the
 * funds, oldest first; optionally the challenge transaction and the reviewer's nonce. Returns the dossier JSON text,
 * or throws with the reason.
 */
export function build_dossier(ufvk: string, network: string, txs_hex: string[], control_hex?: string | null, nonce?: string | null, subject?: string | null, created?: string | null): string;

/**
 * Check every claim of a dossier. `txs` is `{ "<txid>": { "hex": "...", "height": 123 | null, "mempool": bool } }`;
 * `expect_nonce` (empty for none) is the nonce the reviewer issued, which every control claim must answer. Returns the
 * report (`zeceipt-dossier-report-v1`), or `{ error, stage: "parse" }` for a dossier that does not parse; never throws
 * for a claim that fails.
 */
export function check_dossier(dossier: string, txs: any, expect_nonce: string): any;

/**
 * Check only the envelope's issuer signature (no transaction needed).
 * Returns `{ signed: bool, valid: bool, issuer_pubkey?: string, error?: string }`.
 */
export function check_signature(receipt: string): any;

/**
 * The txids whose outputs a dossier's origin transactions spend (fetch them too; spec/dossier-v1.md): the funders'
 * addresses and values come from those outputs. `txs` as for `check_dossier`.
 */
export function dossier_prevout_txids(dossier: string, txs: any): any;

/**
 * The txids a source-of-funds dossier's checks need (spec/dossier-v1.md): the caller fetches each, with its height.
 * Throws on a dossier that does not parse.
 */
export function dossier_txids(dossier: string): any;

/**
 * Is this input a `zdp:1:` delivery proof rather than a receipt? (Any `zdp:` prefix: another version is then refused
 * by name.)
 */
export function is_delivery_proof(input: string): boolean;

/**
 * Compare a receipt with a well-known file (spec §7): `body` as served by `served_by`, the domain the caller fetched
 * from. Returns `{ state: "confirmed" | "not_listed", domain }` or `{ state: "unknown", reason }`. Never a verdict on
 * the receipt's validity.
 */
export function issuer_binding(receipt: string, served_by: string, body: Uint8Array): any;

/**
 * The domain a receipt's signed key id claims (spec §7), when the receipt is signed, its signature verifies and the
 * key id is `<label>@<domain>`: `{ claim: { label, domain, url } }`; otherwise `{ binding: { state: "unknown", reason } }`
 * (nothing to look up). Makes no request: the caller fetches `url` only when its user asks.
 */
export function issuer_claim(receipt: string): any;

/**
 * Decode a `zdp:1:` delivery proof: `{ txid, pool, output_index, value_zat }` (display-order txid), so the caller can
 * fetch the transaction it names. Throws on a malformed proof.
 */
export function parse_delivery_proof(input: string): any;

/**
 * Parse a receipt (JSON, URL, or base64url payload) and return it as a JS object.
 */
export function parse_receipt(input: string): any;

/**
 * Check a `zdp:1:` delivery proof against `raw_tx_hex` (zcash-delivery-proof SPEC §4; `zeceipt_core::delivery`).
 * `network` (`main`, `test` or `regtest`) only chooses how the recipient is written: a proof does not name its
 * network. Returns the same shape as `verify_receipt`, with `kind: "delivery-proof"`; never throws for a proof that
 * does not hold.
 */
export function verify_delivery_proof(proof: string, raw_tx_hex: string, network: string): any;

/**
 * Verify `receipt` against `raw_tx_hex`. `challenge` is the expected challenge
 * (UTF-8, empty if none). Returns a plain object; never throws for invalid receipts.
 */
export function verify_receipt(receipt: string, raw_tx_hex: string, challenge: string, require_signature: boolean): any;

/**
 * Library version string.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_dossierscanner_free: (a: number, b: number) => void;
    readonly build_dossier: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number, number];
    readonly check_dossier: (a: number, b: number, c: any, d: number, e: number) => any;
    readonly check_signature: (a: number, b: number) => any;
    readonly dossier_prevout_txids: (a: number, b: number, c: any) => [number, number, number];
    readonly dossier_txids: (a: number, b: number) => [number, number, number];
    readonly dossierscanner_found: (a: number) => any;
    readonly dossierscanner_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly dossierscanner_scan_block: (a: number, b: number, c: number) => [bigint, number, number];
    readonly is_delivery_proof: (a: number, b: number) => number;
    readonly issuer_binding: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly issuer_claim: (a: number, b: number) => any;
    readonly parse_delivery_proof: (a: number, b: number) => [number, number, number];
    readonly parse_receipt: (a: number, b: number) => [number, number, number];
    readonly verify_delivery_proof: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly verify_receipt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly version: () => [number, number];
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
