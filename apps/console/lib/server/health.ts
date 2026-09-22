// `GET /api/health` (slice C2): the IETF health-check response format (draft-inadarei-api-health-check,
// research log R57): media type `application/health+json`, `status` "pass" with 200 or "fail" with 503.
// Deliberately minimal: no version, path, org, network or error output (the draft warns that health
// details help attackers). Zkool and lightwalletd are not checked: restarting the console does not fix a
// wallet outage (design 3.3.1.1.6.7).

import { serverContext } from "./context.ts";

export const HEALTH_CONTENT_TYPE = "application/health+json";

export function healthResponse(): Response {
  let ok: boolean;
  try {
    ok = (serverContext().db.$client.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined)?.ok === 1;
  } catch {
    ok = false; // not booted, or the database cannot answer: fail, without internals
  }
  const status = ok ? "pass" : "fail";
  return new Response(JSON.stringify({ status, checks: { "sqlite:responsiveness": [{ status }] } }), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": HEALTH_CONTENT_TYPE, "Cache-Control": "no-store" },
  });
}
