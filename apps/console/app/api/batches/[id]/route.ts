import { getBatchResponse } from "../../../../lib/http/batches.ts";
import { guarded } from "../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => getBatchResponse((await ctx.params).id));
