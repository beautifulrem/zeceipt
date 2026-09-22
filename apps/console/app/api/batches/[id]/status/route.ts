import { guarded } from "../../../../../lib/http/route.ts";
import { executionProblem, statusResponse } from "../../../../../lib/http/submit.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => statusResponse((await ctx.params).id), executionProblem);
