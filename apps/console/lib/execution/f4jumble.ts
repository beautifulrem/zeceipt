// F4Jumble (ZIP 316, "Jumbling"): the unkeyed 4-round Feistel construction that a unified address's encoding
// wraps its items in, so that a small typo changes every byte. The console needs the inverse to read a UA's
// receivers (review H1: a checksum alone accepts strings that are not unified addresses). The forward direction is
// kept for the official test vectors (zcash-test-vectors `f4jumble.json`), which check both ways.
//
// BLAKE2b comes from @noble/hashes (audited, pure JS; Node's crypto has no BLAKE2b personalisation).

import { blake2b } from "@noble/hashes/blake2.js";

/** ZIP 316's bounds on the jumbled message length, in bytes (Revision 0). */
export const F4_MIN = 48;
export const F4_MAX = 4_194_368;

const enc = new TextEncoder();
const H_PERSONAL = enc.encode("UA_F4Jumble_H"); // 13 bytes, then [i, 0, 0]
const G_PERSONAL = enc.encode("UA_F4Jumble_G"); // 13 bytes, then [i] || LE16(j)

function personal(prefix: Uint8Array, tail: number[]): Uint8Array {
  const p = new Uint8Array(16);
  p.set(prefix, 0);
  p.set(tail, prefix.length);
  return p;
}

/** H_i(u): BLAKE2b-(8·ℓ_L) of u, personalised "UA_F4Jumble_H" || [i, 0, 0]. */
function H(i: number, u: Uint8Array, lL: number): Uint8Array {
  return blake2b(u, { dkLen: lL, personalization: personal(H_PERSONAL, [i, 0, 0]) });
}

/** G_i(u): the first ℓ_R bytes of BLAKE2b-512(u) blocks personalised "UA_F4Jumble_G" || [i] || LE16(j), j = 0, 1, … */
function G(i: number, u: Uint8Array, lR: number): Uint8Array {
  const out = new Uint8Array(lR);
  for (let j = 0, off = 0; off < lR; j++, off += 64) {
    const block = blake2b(u, { dkLen: 64, personalization: personal(G_PERSONAL, [i, j & 0xff, j >> 8]) });
    out.set(block.subarray(0, Math.min(64, lR - off)), off);
  }
  return out;
}

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => a.map((v, k) => v ^ b[k]);

function split(m: Uint8Array): [Uint8Array, Uint8Array, number, number] {
  if (m.length < F4_MIN || m.length > F4_MAX) throw new RangeError(`F4Jumble input must be ${F4_MIN}..${F4_MAX} bytes, got ${m.length}`);
  const lL = Math.min(64, Math.floor(m.length / 2));
  const lR = m.length - lL;
  return [m.subarray(0, lL), m.subarray(lL), lL, lR];
}

export function f4jumble(m: Uint8Array): Uint8Array {
  const [a, b, lL, lR] = split(m);
  const x = xor(b, G(0, a, lR));
  const y = xor(a, H(0, x, lL));
  const d = xor(x, G(1, y, lR));
  const c = xor(y, H(1, d, lL));
  const out = new Uint8Array(m.length);
  out.set(c, 0);
  out.set(d, lL);
  return out;
}

export function f4jumbleInv(m: Uint8Array): Uint8Array {
  const [c, d, lL, lR] = split(m);
  const y = xor(c, H(1, d, lL));
  const x = xor(d, G(1, y, lR));
  const a = xor(y, H(0, x, lL));
  const b = xor(x, G(0, a, lR));
  const out = new Uint8Array(m.length);
  out.set(a, 0);
  out.set(b, lL);
  return out;
}
