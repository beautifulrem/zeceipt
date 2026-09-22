import { healthResponse } from "../../../lib/server/health.ts";

// Always evaluated per request: a health check must never be served from a cache.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return healthResponse();
}
