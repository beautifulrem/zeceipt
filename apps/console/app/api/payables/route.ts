import { createPayableResponse, listPayablesResponse, payablesProblem } from "../../../lib/http/payables.ts";
import { guarded } from "../../../lib/http/route.ts";

export const dynamic = "force-dynamic";

export const GET = guarded(() => listPayablesResponse(), payablesProblem);
export const POST = guarded((req) => createPayableResponse(req), payablesProblem);
