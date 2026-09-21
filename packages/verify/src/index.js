// Thin typed wrapper over the wasm-pack output in ../pkg.
// Fetching the raw transaction is the caller's job (gRPC-web, proxy, or file),
// so this package never talks to the network by itself.
import init, { parse_receipt, verify_receipt, version } from "../pkg/zeceipt_wasm.js";

let ready;
export async function initVerifier(wasmUrl) {
  if (!ready) ready = init(wasmUrl);
  await ready;
  return version();
}

export function parseReceipt(input) {
  return parse_receipt(input);
}

/**
 * Verify a receipt against a raw transaction.
 * @param {string} receipt JSON, URL or base64url payload
 * @param {string} rawTxHex raw transaction bytes as hex
 * @param {{challenge?: string, requireSignature?: boolean}} [opts]
 */
export function verifyReceipt(receipt, rawTxHex, opts = {}) {
  return verify_receipt(receipt, rawTxHex, opts.challenge ?? "", opts.requireSignature ?? false);
}

/** Default gRPC-web endpoints that serve lightwalletd over HTTPS. */
export const GRPC_WEB_ENDPOINTS = {
  main: ["https://zjs.zec.rocks/mainnet", "https://zcash-mainnet.chainsafe.dev"],
  test: ["https://zjs.zec.rocks/testnet"],
};
