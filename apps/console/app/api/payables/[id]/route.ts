import { getPayableResponse, payablesProblem } from "../../../../lib/http/payables.ts";
import { guarded } from "../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => getPayableResponse((await ctx.params).id), payablesProblem);
