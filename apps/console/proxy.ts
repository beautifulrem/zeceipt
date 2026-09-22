// Pages and static files pass the console's one request-guard rule here (lib/http/guard.ts): loopback
// Host, and for unsafe methods (Server Action POSTs) no cross-site origin.
//
// `/api/` is deliberately outside this matcher. Measured on Next.js 16.3.6: a request that passes
// through the proxy has its body cloned and fully read before anything answers it, even an answer from
// the proxy itself, so an oversize or stalled upload could never be refused early. API routes therefore
// apply the same rule themselves through `guarded()` (lib/http/route.ts); `test/route-guard.test.ts`
// proves every exported method of every route file does, and `test/http-guard.test.ts` pins this matcher.

import { requestProblem } from "./lib/http/guard.ts";

export function proxy(req: Request): Response | undefined {
  return requestProblem(req.method, req.headers) ?? undefined;
}

export const config = { matcher: "/((?!api/).*)" };
