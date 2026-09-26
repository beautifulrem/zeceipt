import { exportProblem, openZcashExportResponse } from "../../../../../../lib/http/exports.ts";
import { guarded } from "../../../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (req, ctx: Ctx) => openZcashExportResponse((await ctx.params).id, req.headers), exportProblem);
