import { guarded } from "../../../lib/http/route.ts";
import { healthResponse } from "../../../lib/server/health.ts";

// Always evaluated per request: a health check must never be served from a cache.
export const dynamic = "force-dynamic";

export const GET = guarded(async () => healthResponse());
