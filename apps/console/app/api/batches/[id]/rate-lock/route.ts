import { lockRateResponse, ratesProblem } from "../../../../../lib/http/rates.ts";
import { guarded } from "../../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const POST = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => lockRateResponse((await ctx.params).id), ratesProblem);
