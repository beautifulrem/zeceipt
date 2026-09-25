import { guarded } from "../../../../../lib/http/route.ts";
import { voidBatchResponse, voidsProblem } from "../../../../../lib/http/voids.ts";

export const dynamic = "force-dynamic";

export const POST = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => voidBatchResponse((await ctx.params).id), voidsProblem);
