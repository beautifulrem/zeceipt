// Issuer key ids (spec §7): a label, optionally `@<domain>` to claim a domain whose well-known file binds the key.
// The rule has one definition, `claim` in zeceipt-types; spec/test-vectors/binding-claims-v0.json is generated from it,
// and the console's tests check this validator against that file (slice W2a).

const LABEL = /^[A-Za-z0-9._-]{1,64}$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface KeyIdClaim {
  label: string;
  /** ASCII only (`xn--` A-labels for internationalised names), shown exactly as written. */
  domain: string;
  url: string;
}

/** The domain a key id claims, or undefined when it claims none (exactly one `@`, a valid label, an ASCII LDH domain). */
export function keyIdClaim(keyId: string): KeyIdClaim | undefined {
  const at = keyId.indexOf("@");
  if (at < 0 || keyId.indexOf("@", at + 1) >= 0) return undefined;
  const label = keyId.slice(0, at);
  const domain = keyId.slice(at + 1);
  if (!LABEL.test(label) || domain.length > 253) return undefined;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => DNS_LABEL.test(l))) return undefined;
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return undefined; // an IPv4 literal, or a numeric TLD
  return { label, domain, url: `https://${domain}/.well-known/zeceipt.json` };
}

/** A key id the console may sign with: a plain label, or a label that claims a domain (spec §7). */
export function isIssuerKeyId(keyId: string): boolean {
  return keyId.includes("@") ? keyIdClaim(keyId) !== undefined : LABEL.test(keyId);
}
