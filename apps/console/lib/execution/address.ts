// Unified address checks (ZIP 316), for preflight, batch lines and recipients. The structure is decoded since
// review H1: at most MAX_ADDRESS_CHARS (what the console stores); the network's human-readable part; a valid Bech32m
// checksum over the whole string (UAs use Bech32m "ignoring any length restrictions"); then the payload: F4Jumble
// inverted (ZIP 316 bounds 48..4194368 bytes), the 16-byte HRP padding checked and removed, and the items parsed
// (typecode, length, value, as canonical CompactSizes; known receivers at their exact lengths; typecodes strictly
// ascending; not both transparent kinds; no MUST-understand metadata; no trailing bytes).
// Not checked: whether a receiver's bytes are a valid encoding (say an Orchard `pk_d` that is a Pallas point). Zkool
// refuses such an address while planning, before it builds, and `isPreBuildRefusal` maps that to `payment_rejected`
// with nothing sent (review H1 round 2; probed on regtest, research log R76).
// The console pays Ironwood to the Orchard receiver, so an address without one is refused (as Konclave's
// `ua_receiver` refuses a UA "with no Orchard receiver"). Checked against the official zcash-test-vectors.

import { f4jumbleInv, F4_MAX, F4_MIN } from "./f4jumble.ts";
import type { Network } from "./types.ts";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

/** Revision-0 unified address HRPs. Ironwood pays to the Orchard receiver of a UA. */
export const UA_HRP: Record<Network, string> = { main: "u", test: "utest", regtest: "uregtest" };

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

export type AddressProblemCode = "address_hrp" | "address_checksum" | "address_malformed" | "address_no_orchard";
export type AddressCheck = { ok: true; hrp: string; receivers: UaReceiver[] } | { ok: false; code: AddressProblemCode; detail: string };

/** The longest address the console stores (the `recipients_address` and `batch_items_address` CHECKs). */
export const MAX_ADDRESS_CHARS = 1000;

/** ZIP 316 typecodes of Revision 0 receivers, with their exact encodings' lengths. */
export const TYPECODE = { p2pkh: 0x00, p2sh: 0x01, sapling: 0x02, orchard: 0x03 } as const;
const KNOWN_LENGTH: Record<number, number> = { 0x00: 20, 0x01: 20, 0x02: 43, 0x03: 43 };

export interface UaReceiver {
  typecode: number;
  data: Uint8Array;
}

/** Split and checksum-verify a Bech32m string of any length; `words` are the 5-bit data values without the checksum. */
export function bech32mCheck(s: string): { hrp: string; words: number[] } | null {
  if (s !== s.toLowerCase()) return null;
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) return null;
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (const c of s.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    data.push(v);
  }
  return polymod([...hrpExpand(hrp), ...data]) === BECH32M_CONST ? { hrp, words: data.slice(0, -6) } : null;
}

/** 5-bit words to bytes; the leftover bits must be fewer than 5 and all zero (BIP 173's rule). */
function wordsToBytes(words: number[]): Uint8Array | null {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= 5 || acc !== 0) return null;
  return Uint8Array.from(out);
}

/** A canonical CompactSize at `pos`: [value, next position], or null if truncated or not minimally encoded. */
function compactSize(b: Uint8Array, pos: number): [number, number] | null {
  if (pos >= b.length) return null;
  const first = b[pos];
  if (first < 0xfd) return [first, pos + 1];
  const width = first === 0xfd ? 2 : first === 0xfe ? 4 : 0; // 8-byte sizes are never valid here
  if (width === 0 || pos + 1 + width > b.length) return null;
  let v = 0;
  for (let k = width - 1; k >= 0; k--) v = v * 256 + b[pos + 1 + k];
  const min = width === 2 ? 0xfd : 0x10000;
  return v < min ? null : [v, pos + 1 + width];
}

/**
 * Decode a unified address's receivers (ZIP 316, Revision 0) after the HRP and checksum checks. Returns the
 * receivers in encoding order, or a reason the payload is malformed.
 */
export function decodeUnifiedAddress(words: number[], hrp: string): { receivers: UaReceiver[] } | { error: string } {
  const jumbled = wordsToBytes(words);
  if (!jumbled) return { error: "the data is not whole bytes" };
  if (jumbled.length < F4_MIN || jumbled.length > F4_MAX) return { error: `the payload is ${jumbled.length} bytes (a unified address has ${F4_MIN}–${F4_MAX})` };
  const raw = f4jumbleInv(jumbled);
  const padding = raw.subarray(raw.length - 16);
  const expected = new Uint8Array(16);
  expected.set(new TextEncoder().encode(hrp).subarray(0, 16));
  if (!padding.every((v, k) => v === expected[k])) return { error: "the payload's padding does not match its prefix (not a unified address)" };
  const items = raw.subarray(0, raw.length - 16);
  const receivers: UaReceiver[] = [];
  let pos = 0;
  let lastTypecode = -1;
  while (pos < items.length) {
    const t = compactSize(items, pos);
    if (!t) return { error: "an item's typecode is truncated or not canonical" };
    const l = compactSize(items, t[1]);
    if (!l) return { error: "an item's length is truncated or not canonical" };
    const [typecode] = t;
    const [length, start] = l;
    if (start + length > items.length) return { error: "an item runs past the end of the address" };
    if (KNOWN_LENGTH[typecode] !== undefined && KNOWN_LENGTH[typecode] !== length) return { error: `typecode ${typecode} must be ${KNOWN_LENGTH[typecode]} bytes, got ${length}` };
    if (typecode <= lastTypecode) return { error: "typecodes must be unique and in ascending order" };
    lastTypecode = typecode;
    // Metadata Items (ZIP 316) are typecodes 0xC0–0xFC. A Revision 0 address MUST NOT carry a MUST-understand one
    // (0xE0–0xFC), so a reader refuses it (review H1 round 2); the rest (0xC0–0xDF) are ignored, not receivers.
    // Typecodes above 0xFC (such as the experimental 0xFFFA–0xFFFF) are receivers again, as the official vectors show.
    if (typecode >= 0xe0 && typecode <= 0xfc) return { error: `typecode ${typecode} is MUST-understand metadata, not allowed in a Revision 0 address` };
    if (typecode < 0xc0 || typecode > 0xfc) receivers.push({ typecode, data: items.slice(start, start + length) });
    pos = start + length;
  }
  if (receivers.length === 0) return { error: "the address has no receivers" };
  const has = (tc: number) => receivers.some((r) => r.typecode === tc);
  if (has(TYPECODE.p2pkh) && has(TYPECODE.p2sh)) return { error: "an address cannot hold both transparent receiver kinds" };
  if (!receivers.some((r) => r.typecode !== TYPECODE.p2pkh && r.typecode !== TYPECODE.p2sh)) return { error: "a unified address must contain at least one shielded receiver" };
  return { receivers };
}

export function checkUnifiedAddress(address: string, network: Network): AddressCheck {
  const want = UA_HRP[network];
  const hrp = address.slice(0, Math.max(0, address.lastIndexOf("1")));
  if (hrp !== want) {
    return { ok: false, code: "address_hrp", detail: `expected a ${network} unified address (${want}1…), got prefix ${JSON.stringify(hrp || address.slice(0, 8))}` };
  }
  // The console stores at most MAX_ADDRESS_CHARS (the recipients and batch_items CHECKs): refuse longer ones here, as a
  // problem, not as a database error (review H1 round 2: a valid 1,239-character UA gave a 500).
  if (address.length > MAX_ADDRESS_CHARS) return { ok: false, code: "address_malformed", detail: `the address is ${address.length} characters, longer than the console stores (${MAX_ADDRESS_CHARS})` };
  const r = bech32mCheck(address);
  if (!r) return { ok: false, code: "address_checksum", detail: "Bech32m checksum does not verify (typo or truncated address)" };
  const decoded = decodeUnifiedAddress(r.words, r.hrp);
  if ("error" in decoded) return { ok: false, code: "address_malformed", detail: `not a valid unified address: ${decoded.error}` };
  if (!decoded.receivers.some((x) => x.typecode === TYPECODE.orchard)) {
    return { ok: false, code: "address_no_orchard", detail: "the unified address has no Orchard receiver, which this console pays (Ironwood)" };
  }
  return { ok: true, hrp: r.hrp, receivers: decoded.receivers };
}
