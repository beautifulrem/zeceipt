// The console's one request-guard rule (slice D1, design 3.3.1.4.1.2–.4; research R59, R60), applied to
// every request by `proxy.ts` and again by route handlers for unsafe methods.
//
// Until authentication exists (leaf 3.3.1.2) the console is reachable only from its own machine:
// - Host must be a loopback name: stops DNS rebinding, where a hostile page re-points its own name at
//   127.0.0.1 and reads the responses (Vite GHSA-vg6x-rcgg-rjx6; its fix allows only localhost names).
// - Unsafe methods must not come from another site: `Sec-Fetch-Site` cross-site/same-site are refused
//   (OWASP), and a present `Origin` must be this Host's own origin; `Origin: null` is refused.
//   A request with neither header is not from a browser (browsers send Origin on every cross-origin
//   request and every same-origin non-GET/HEAD request, MDN), so it carries no ambient browser
//   authority and passes. The authentication leaf revisits this once cookies exist.

import { problem } from "./problem.ts";

export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`, optionally with a numeric port; nothing else. */
export function isAllowedHost(host: string | null): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]*\]|[^:]+)(?::(\d{1,5}))?$/.exec(host.toLowerCase());
  if (!m) return false;
  const name = m[1];
  return LOOPBACK_NAMES.has(name) || /^([a-z0-9-]+\.)+localhost$/.test(name);
}

/** Null when the request may proceed; otherwise the 403 problem response to send instead. */
export function requestProblem(method: string, headers: Headers): Response | null {
  const host = headers.get("host");
  if (!isAllowedHost(host)) {
    return problem(403, "host_not_allowed", "this console answers only on a loopback host name (localhost, 127.0.0.1, [::1])");
  }
  if (SAFE_METHODS.has(method.toUpperCase())) return null;

  const crossSite = crossSiteProblem(headers, "requests that change data must come from this console's own pages");
  if (crossSite) return crossSite;
  const origin = headers.get("origin");
  if (origin !== null && origin !== `http://${host}` && origin !== `https://${host}`) {
    return problem(403, "origin_mismatch", "requests that change data must come from this console's own origin");
  }
  return null;
}

/**
 * `Sec-Fetch-Site` cross-site or same-site → 403 (OWASP's fetch-metadata resource isolation); absent (not a browser),
 * `same-origin` or `none` (typed or bookmarked) pass. Unsafe methods always apply it; a GET that returns secrets and
 * records an event applies it too (slice X2b: the OpenZcash export), so another site cannot make the operator's
 * browser download receipt links or write to the audit log.
 */
export function crossSiteProblem(headers: Headers, detail: string): Response | null {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return problem(403, "cross_site_request", detail);
  return null;
}
