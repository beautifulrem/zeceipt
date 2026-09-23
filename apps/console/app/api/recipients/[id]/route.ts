import { getRecipientResponse, recipientsProblem } from "../../../../lib/http/recipients.ts";
import { guarded } from "../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, ctx: { params: Promise<{ id: string }> }) => getRecipientResponse((await ctx.params).id), recipientsProblem);
