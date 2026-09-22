import { guarded } from "../../../../../lib/http/route.ts";
import { submitResponse } from "../../../../../lib/http/submit.ts";

export const dynamic = "force-dynamic";

export const POST = guarded(async (req, ctx: { params: Promise<{ id: string }> }) => submitResponse(req, (await ctx.params).id));
