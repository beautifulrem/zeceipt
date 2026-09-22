// RFC 9457 problem details for every console error response (slice D1, design 3.3.1.4.1.1; research R58).
// `type` stays "about:blank", so `title` is the HTTP status phrase; the machine-readable reason is the
// extension member `code`. `detail` is always our own fixed text: no stack, SQL, path or input value.

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The body of every console problem response; routes may add extension members (e.g. `problems`, `issues`). */
export interface ProblemJson {
  type: "about:blank";
  title: string;
  status: number;
  detail: string;
  code: string;
  problems?: { code: string; index?: number; detail: string }[];
  /** Submit problems (slice D2): what this request did (the batch's own state is at `status`). */
  thisRequest?: "sent_nothing" | "may_have_sent";
  /** Submit problems: the batch's status route (not RFC 9457's `status`, which is the HTTP status code). */
  batchStatus?: string;
  issues?: { path: string; message: string }[];
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export function problem(status: number, code: string, detail: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  const body = { ...extra, type: "about:blank", title: TITLES[status] ?? "Error", status, detail, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": PROBLEM_CONTENT_TYPE, "Cache-Control": "no-store" },
  });
}

/** An error that already knows its HTTP answer (thrown by request parsing, caught by the handlers). */
export class HttpProblem extends Error {
  readonly response: Response;
  readonly #args: [number, string, string, Record<string, unknown>, Record<string, string>];
  constructor(status: number, code: string, detail: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(`${status} ${code}: ${detail}`);
    this.name = "HttpProblem";
    this.#args = [status, code, detail, extra, headers];
    this.response = problem(status, code, detail, extra, headers);
  }
  /** The same problem with more extension members (existing ones win). */
  withExtra(more: Record<string, unknown>): HttpProblem {
    const [status, code, detail, extra, headers] = this.#args;
    return new HttpProblem(status, code, detail, { ...more, ...extra }, headers);
  }
}

/** The answer to anything unexpected: a fixed detail, never the error itself. */
export function internalError(): Response {
  return problem(500, "internal", "the console could not complete this request");
}
