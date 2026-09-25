import type { NextConfig } from "next";
import { MAX_BODY_BYTES } from "./lib/http/body.ts";

/**
 * Sent on every response (slice S4, R98). A framed console page posts same-origin, so the request guard cannot
 * stop clickjacking: the frame itself is refused, twice as OWASP advises (CSP `frame-ancestors`, and
 * `X-Frame-Options` for browsers without it). The CSP holds only directives that cannot break Next's scripts
 * (a `script-src` needs nonces). No `Referer` carries a console URL out.
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  experimental: {
    // Requests that pass through proxy.ts (pages, static files, future Server Action POSTs; not /api/)
    // have their bodies buffered by Next before anything answers. This caps that buffer at our ceiling
    // instead of the default 10 MiB. Past it, Next logs a warning, drops the chunk that crossed it and
    // everything after, and the page sees a truncated body (read in next/dist/server/body-streams.js;
    // measured: a 640 KiB JSON body arrived cut short). It bounds memory; it is not a validation.
    // API routes are outside the proxy and refuse oversize bodies themselves (lib/http/body.ts).
    proxyClientMaxBodySize: MAX_BODY_BYTES,
  },
};

export default nextConfig;
