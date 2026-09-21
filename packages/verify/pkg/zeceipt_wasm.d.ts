/* tslint:disable */
/* eslint-disable */

/**
 * Check only the envelope's issuer signature (no transaction needed).
 * Returns `{ signed: bool, valid: bool, issuer_pubkey?: string, error?: string }`.
 */
export function check_signature(receipt: string): any;

/**
 * Parse a receipt (JSON, URL, or base64url payload) and return it as a JS object.
 */
export function parse_receipt(input: string): any;

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
    readonly check_signature: (a: number, b: number) => any;
    readonly parse_receipt: (a: number, b: number) => [number, number, number];
    readonly verify_receipt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly version: () => [number, number];
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
