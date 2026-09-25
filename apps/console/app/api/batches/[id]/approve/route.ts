import { approveResponse, approvalsProblem } from "../../../../../lib/http/approvals.ts";
import { guarded } from "../../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const POST = guarded(async (req, ctx: { params: Promise<{ id: string }> }) => approveResponse(req, (await ctx.params).id), approvalsProblem);
