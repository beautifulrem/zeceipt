// Pages and static files pass the console's one request-guard rule here (lib/http/guard.ts): loopback
// Host, and for unsafe methods (Server Action POSTs) no cross-site origin. Then each response gets its own
// script nonce (slice S4b, lib/http/csp.ts).
//
// `/api/` is deliberately outside this matcher. Measured on Next.js 16.3.6: a request that passes
// through the proxy has its body cloned and fully read before anything answers it, even an answer from
// the proxy itself, so an oversize or stalled upload could never be refused early. API routes therefore
// apply the same rule themselves through `guarded()` (lib/http/route.ts); `test/route-guard.test.ts`
// proves every exported method of every route file does, and `test/http-guard.test.ts` pins this matcher.

import { NextResponse } from "next/server.js";
import { newNonce, pagePolicy } from "./lib/http/csp.ts";
import { requestProblem } from "./lib/http/guard.ts";

export function proxy(req: Request): Response {
  const refused = requestProblem(req.method, req.headers);
  if (refused) return refused;
  const nonce = newNonce();
  const policy = pagePolicy(nonce, process.env.NODE_ENV === "development");
  // Next reads the nonce from the request's CSP header and puts it on the scripts it renders.
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", policy);
  const res = NextResponse.next({ request: { headers } });
  // Replaces next.config's CSP on this response (measured: not merged), so it carries S4's directives too.
  res.headers.set("content-security-policy", policy);
  return res;
}

export const config = { matcher: "/((?!api/).*)" };
