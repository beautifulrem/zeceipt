import { historyResponse } from "../../../../../lib/http/history.ts";
import { guarded } from "../../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => historyResponse((await ctx.params).id));
