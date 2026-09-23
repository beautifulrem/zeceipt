import { createFromPayablesResponse, payableBatchesProblem } from "../../../../lib/http/payable-batches.ts";
import { guarded } from "../../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const POST = guarded((req) => createFromPayablesResponse(req), payableBatchesProblem);
