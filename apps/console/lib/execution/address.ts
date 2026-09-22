// Unified address checks for preflight (ZIP 316): expected human-readable part per network and a
// valid Bech32m checksum over the whole string (ZIP 316 encodes UAs with Bech32m "ignoring any length
// restrictions"). Receiver-level validity (a well-formed Orchard receiver, F4Jumble) is enforced later
// by Zkool when it builds the transaction and by `zeceipt issue --only-to`, which decodes receivers.

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

export type AddressCheck = { ok: true; hrp: string } | { ok: false; code: "address_hrp" | "address_checksum"; detail: string };

/** Split and checksum-verify a Bech32m string of any length. */
export function bech32mCheck(s: string): { hrp: string } | null {
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
  return polymod([...hrpExpand(hrp), ...data]) === BECH32M_CONST ? { hrp } : null;
}

export function checkUnifiedAddress(address: string, network: Network): AddressCheck {
  const want = UA_HRP[network];
  const hrp = address.slice(0, Math.max(0, address.lastIndexOf("1")));
  if (hrp !== want) {
    return { ok: false, code: "address_hrp", detail: `expected a ${network} unified address (${want}1…), got prefix ${JSON.stringify(hrp || address.slice(0, 8))}` };
  }
  const r = bech32mCheck(address);
  if (!r) return { ok: false, code: "address_checksum", detail: "Bech32m checksum does not verify (typo or truncated address)" };
  return { ok: true, hrp: r.hrp };
}
