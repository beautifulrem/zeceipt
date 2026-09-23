// How every API route is built (slice D1, review round 1): `guarded(handler)` applies the console's one
// request-guard rule, then runs the handler and maps every failure to problem+json.
//
// Why routes guard themselves instead of relying on proxy.ts (measured on Next.js 16.3.6, design
// 3.3.1.4.1.2): when a request passes through the proxy, Next clones its body and waits for the whole
// upload before the route runs, even when the proxy itself answers. A 9 MB declared body got no answer at
// all, and a stalled chunked body waited until the client finished. With `/api/` outside the proxy's
// matcher, a route gets the live stream, so `readJson` refuses an oversize body at once (0.02 s, measured).
// `test/route-guard.test.ts` imports every route file and proves each exported method is guarded.

import { ContextNotReadyError } from "../server/context.ts";
import { requestProblem } from "./guard.ts";
import { HttpProblem, internalError, problem } from "./problem.ts";

/** A domain failure that knows its problem response (e.g. a batch that fails validation). */
export interface ProblemMapper {
  (e: unknown): Response | undefined;
}

export function guarded<C = unknown>(handler: (req: Request, ctx: C) => Promise<Response>, map: ProblemMapper = () => undefined) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const refused = requestProblem(req.method, req.headers);
    if (refused) return refused;
    return answer(() => handler(req, ctx), map);
  };
}

/**
 * Run a handler and map every failure to its problem response: the routes' mapping without the request
 * guard, for callers that are already guarded (the page's Server Actions pass `proxy.ts` and Next's own
 * Origin check; slice E2), so a page action answers exactly what the API would.
 */
export async function answer(run: () => Promise<Response>, map: ProblemMapper = () => undefined): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpProblem) return e.response;
    if (e instanceof ContextNotReadyError) return problem(503, "not_ready", "the console has not finished starting");
    return map(e) ?? internalError();
  }
}
