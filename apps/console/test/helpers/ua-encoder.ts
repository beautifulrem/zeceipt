// A tiny ZIP 316 unified-address encoder for tests (review H1): items → HRP padding → F4Jumble → Bech32m, so each
// decoding rule can be exercised alone and two addresses can share a receiver.
import { f4jumble } from "../../lib/execution/f4jumble.ts";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
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
function bech32m(hrp: string, bytes: Uint8Array): string {
  const words: number[] = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const exp = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...exp, ...words, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join("")}`;
}
export function ua(hrp: string, items: number[][], paddingHrp = hrp): string {
  const body = items.flat();
  const pad = new Uint8Array(16);
  pad.set(new TextEncoder().encode(paddingHrp));
  const raw = Uint8Array.from([...body, ...pad]);
  // Below ZIP 316's 48-byte minimum F4Jumble is undefined; such a payload is emitted as is (the decoder must refuse it).
  return bech32m(hrp, raw.length < 48 ? raw : f4jumble(raw));
}
export const item = (typecode: number, len: number, fill = 7) => [typecode, len, ...new Array(len).fill(fill)];
/** An item whose length needs a 3-byte CompactSize (253..65535 bytes), for addresses longer than the console stores. */
export const bigItem = (typecode: number, len: number, fill = 7) => [typecode, 0xfd, len & 0xff, len >> 8, ...new Array(len).fill(fill)];
/** A valid regtest UA of 1,000+ characters: Orchard, then an unknown receiver typecode of 640 bytes (review H1 round 2). */
export const longUa = () => ua("uregtest", [item(3, 43), bigItem(0x10, 640)]);
