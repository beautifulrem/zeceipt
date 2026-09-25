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
