// Thin typed wrapper over the wasm-pack output in ../pkg.
// Fetching the raw transaction is the caller's job (gRPC-web, proxy, or file),
// so this package never talks to the network by itself.
import init, { parse_receipt, verify_receipt, version } from "../pkg/zeceipt_wasm.js";

let ready;
export async function initVerifier(wasmUrl) {
  if (!ready) ready = init(wasmUrl ? { module_or_path: wasmUrl } : undefined);
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

const hexToBytes = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Minimal protobuf helpers for the two messages we need (no dependency).
function encodeTxFilter(txidDisplayHex) {
  const hash = hexToBytes(txidDisplayHex).reverse(); // lightwalletd wants internal byte order
  // TxFilter { bytes hash = 3; }  -> tag 0x1a, len 32, bytes
  const body = new Uint8Array(2 + hash.length);
  body[0] = 0x1a; body[1] = hash.length; body.set(hash, 2);
  // gRPC-web frame: flag(0) + u32 BE length + message
  const frame = new Uint8Array(5 + body.length);
  frame[0] = 0; new DataView(frame.buffer).setUint32(1, body.length, false); frame.set(body, 5);
  return frame;
}
function readVarint(buf, pos) {
  let result = 0n, shift = 0n, i = pos;
  for (;;) { const b = buf[i++]; result |= BigInt(b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7n; }
  return [result, i];
}
function decodeRawTransaction(msg) {
  // RawTransaction { bytes data = 1; uint64 height = 2; }
  let i = 0, data = null, height = null;
  while (i < msg.length) {
    const [tag, p1] = readVarint(msg, i); i = p1;
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 2) { const [len, p2] = readVarint(msg, i); i = p2; const slice = msg.slice(i, i + Number(len)); i += Number(len); if (field === 1) data = slice; }
    else if (wire === 0) { const [v, p2] = readVarint(msg, i); i = p2; if (field === 2) height = v; }
    else throw new Error("unexpected wire type " + wire);
  }
  return { data, height };
}

/**
 * Fetch a raw transaction over gRPC-web from a public lightwalletd. Note: the
 * node learns which txid you asked for. Returns { hex, height, endpoint }.
 */
export async function fetchRawTx(txidDisplayHex, network = "main", endpoints = GRPC_WEB_ENDPOINTS[network]) {
  let lastErr = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${ep}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction`, {
        method: "POST",
        headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
        body: encodeTxFilter(txidDisplayHex),
      });
      const grpcStatus = res.headers.get("grpc-status");
      if (!res.ok || (grpcStatus && grpcStatus !== "0")) throw new Error(`HTTP ${res.status} grpc-status ${grpcStatus ?? "?"} ${res.headers.get("grpc-message") ?? ""}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // frames: [flag][len BE][payload]...; flag 0 = message, 0x80 = trailers
      let pos = 0, message = null;
      while (pos + 5 <= buf.length) {
        const flag = buf[pos]; const len = new DataView(buf.buffer, buf.byteOffset + pos + 1, 4).getUint32(0, false);
        const payload = buf.slice(pos + 5, pos + 5 + len); pos += 5 + len;
        if (flag === 0) message = payload;
        else if (flag & 0x80) { const t = new TextDecoder().decode(payload); const m = /grpc-status:\s*(\d+)/i.exec(t); if (m && m[1] !== "0") throw new Error("grpc trailer: " + t.trim()); }
      }
      if (!message) throw new Error("empty gRPC-web response");
      const { data, height } = decodeRawTransaction(message);
      if (!data || data.length === 0) throw new Error("transaction not found");
      return { hex: bytesToHex(data), height: height === null ? null : Number(height), endpoint: ep };
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("no endpoints");
}
