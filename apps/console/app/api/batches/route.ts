import { batchProblem, createBatchResponse, listBatchesResponse } from "../../../lib/http/batches.ts";
import { guarded } from "../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(() => listBatchesResponse());
export const POST = guarded((req) => createBatchResponse(req), batchProblem);
