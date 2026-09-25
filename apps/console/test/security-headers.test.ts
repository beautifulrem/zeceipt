// Slice S4 (R98): every response refuses to be framed; the values are pinned here, and the app e2e checks them on
// pages, API answers, static files, 404s and refusals through next start, then in Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig, { SECURITY_HEADERS } from "../next.config.ts";

test("next.config sends the security headers on every path: no framing (CSP and X-Frame-Options), nosniff, no Referer", async () => {
  assert.deepEqual(await nextConfig.headers!(), [{ source: "/(.*)", headers: SECURITY_HEADERS }]);
  assert.deepEqual(Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value])), {
    "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
});

test("page policy (slice S4b): S4's directives plus a script-src with this response's nonce and strict-dynamic; 'unsafe-eval' only under next dev; nonces are fresh", async () => {
  const { BASE_POLICY, newNonce, pagePolicy } = await import("../lib/http/csp.ts");
  assert.equal(BASE_POLICY, SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value, "next.config sends the same base");
  assert.equal(pagePolicy("abc=", false), `${BASE_POLICY}; default-src 'self'; script-src 'self' 'nonce-abc=' 'strict-dynamic'; style-src 'self' 'nonce-abc='; img-src 'self' data:; font-src 'self'; connect-src 'self'`);
  assert.equal(pagePolicy("abc=", true), `${BASE_POLICY}; default-src 'self'; script-src 'self' 'nonce-abc=' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'`);
  const nonces = new Set(Array.from({ length: 1000 }, newNonce));
  assert.equal(nonces.size, 1000);
  for (const n of nonces) assert.match(n, /^[A-Za-z0-9+/]{22}==$/, "128 bits, base64");
});
