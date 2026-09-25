// The console's script policy (slice S4b, R103): pages run only the scripts Next rendered for this response. A nonce
// is made per request in proxy.ts and sent in the request's CSP header, where Next reads it and stamps its own script
// tags (Next.js 16.2.9, "Content Security Policy"); `'strict-dynamic'` lets those scripts load the chunks they import.
// Rendering is dynamic everywhere (the root layout awaits `connection()`), so every page gets its own nonce.

/**
 * The directives every response carries (slice S4): no framing, and nothing that could break Next's scripts. next.config
 * sends this on every path; a page's response replaces it with `pagePolicy` (measured: the proxy's header wins, it is
 * not merged), which therefore repeats it.
 */
export const BASE_POLICY = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/** A fresh nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * A page's whole policy: S4's directives, the script directive (S4b), and everything a page loads coming from the console
 * itself (S4c): images (and `data:`), styles (the nonced stylesheet), fonts and connections (Server Actions). Injected
 * markup can then neither run script nor load anything from elsewhere into the page. Top-level navigation is outside
 * CSP: an injected link or `<meta http-equiv="refresh">` can still send the user elsewhere (review S4c, THREAT_MODEL).
 * `next dev` alone gets 'unsafe-eval' and inline styles (fast refresh and its overlay).
 */
export function pagePolicy(nonce: string, dev: boolean): string {
  const script = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`;
  const style = dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`;
  return `${BASE_POLICY}; default-src 'self'; ${script}; ${style}; img-src 'self' data:; font-src 'self'; connect-src 'self'`;
}
