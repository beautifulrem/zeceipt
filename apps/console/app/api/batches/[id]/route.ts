import { handleGet } from "../../../../lib/http/batches.ts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleGet((await ctx.params).id);
}
