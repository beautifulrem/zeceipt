import { issueReceiptsResponse, issuerCli, listReceiptsResponse, receiptsProblem } from "../../../../../lib/http/receipts.ts";
import { guarded } from "../../../../../lib/http/route.ts";
import { serverContext } from "../../../../../lib/server/context.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req, ctx: Ctx) => listReceiptsResponse((await ctx.params).id), receiptsProblem);
export const POST = guarded(async (_req, ctx: Ctx) => issueReceiptsResponse((await ctx.params).id, issuerCli(serverContext().config)), receiptsProblem);
