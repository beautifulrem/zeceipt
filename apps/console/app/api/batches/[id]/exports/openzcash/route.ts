import { exportProblem, openZcashExportResponse } from "../../../../../../lib/http/exports.ts";
import { guarded } from "../../../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (req, ctx: Ctx) => openZcashExportResponse((await ctx.params).id, req.headers), exportProblem);

// Next.js answers HEAD with the GET handler when a route exports no HEAD (R111), which would record an "exported"
// event for a request that downloads nothing. The export is GET only.
export const HEAD = guarded(async () => new Response(null, { status: 405, headers: { Allow: "GET" } }));
