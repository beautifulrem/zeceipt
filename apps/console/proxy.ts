// Every request passes the console's one request-guard rule (lib/http/guard.ts): loopback Host, and for
// unsafe methods no cross-site origin. No `config.matcher`, deliberately: Next.js warns that a matcher
// change can silently remove coverage, so this runs on pages, API routes, static files and Server
// Action POSTs alike (slice D1, design 3.3.1.4.1.2).

import { requestProblem } from "./lib/http/guard.ts";

export function proxy(req: Request): Response | undefined {
  return requestProblem(req.method, req.headers) ?? undefined;
}
