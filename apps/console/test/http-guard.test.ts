// The console's request guard and problem format (slice D1): loopback Host only, no cross-site unsafe
// requests, RFC 9457 problem+json with no-store, and a proxy that has no matcher (so it covers everything).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowedHost, requestProblem } from "../lib/http/guard.ts";
import { HttpProblem, internalError, problem, PROBLEM_CONTENT_TYPE } from "../lib/http/problem.ts";

const h = (o: Record<string, string>) => new Headers(o);
const code = async (r: Response | null) => (r ? ((await r.json()) as { code: string }).code : null);

test("Host: loopback names and IPs with an optional numeric port; nothing else", () => {
  for (const ok of ["localhost", "localhost:3000", "LOCALHOST:3000", "127.0.0.1", "127.0.0.1:8080", "[::1]", "[::1]:3000", "console.localhost", "a.b.localhost:1"]) {
    assert.equal(isAllowedHost(ok), true, ok);
  }
  for (const bad of [null, "", "evil.example", "localhost.evil.example", "evillocalhost", "127.0.0.2", "0.0.0.0", "[::2]", "localhost:", "localhost:abc", "localhost:3000:1", "user@localhost", "10.0.0.1", "[::1", "::1"]) {
    assert.equal(isAllowedHost(bad), false, String(bad));
  }
});

test("rule table: host first, then only unsafe methods are checked for their origin", async () => {
  const H = "127.0.0.1:3000";
  const cases: [string, Record<string, string>, string | null][] = [
    ["GET", { host: "evil.example" }, "host_not_allowed"],
    ["POST", { host: "evil.example", origin: "http://evil.example" }, "host_not_allowed"],
    ["GET", {}, "host_not_allowed"],
    ["GET", { host: H, origin: "http://evil.example", "sec-fetch-site": "cross-site" }, null], // safe method: not an origin question
    ["HEAD", { host: H, "sec-fetch-site": "cross-site" }, null],
    ["OPTIONS", { host: H, "sec-fetch-site": "cross-site" }, null],
    ["POST", { host: H }, null], // no browser headers: not a browser, no ambient authority
    ["POST", { host: H, "sec-fetch-site": "same-origin", origin: `http://${H}` }, null],
    ["POST", { host: H, "sec-fetch-site": "none" }, null],
    ["POST", { host: H, origin: `https://${H}` }, null],
    ["POST", { host: H, "sec-fetch-site": "cross-site" }, "cross_site_request"],
    ["POST", { host: H, "sec-fetch-site": "same-site" }, "cross_site_request"],
    ["DELETE", { host: H, "sec-fetch-site": "cross-site" }, "cross_site_request"],
    ["post", { host: H, "sec-fetch-site": "cross-site" }, "cross_site_request"],
    ["POST", { host: H, origin: "http://evil.example" }, "origin_mismatch"],
    ["POST", { host: H, origin: "null" }, "origin_mismatch"],
    ["POST", { host: H, origin: "http://127.0.0.1:3001" }, "origin_mismatch"], // another port is another origin
    ["POST", { host: H, origin: "http://localhost:3000" }, "origin_mismatch"], // another name is another origin
    ["POST", { host: H, origin: `http://${H}/` }, "origin_mismatch"], // origins never carry a path
    ["PUT", { host: H, origin: "ftp://127.0.0.1:3000" }, "origin_mismatch"],
  ];
  for (const [method, headers, expected] of cases) {
    assert.equal(await code(requestProblem(method, h(headers))), expected, `${method} ${JSON.stringify(headers)}`);
  }
});

test("problem+json: RFC 9457 members, our code, no-store; HttpProblem carries its response; 500 is fixed", async () => {
  const r = problem(403, "host_not_allowed", "fixed text", { extra: 1 });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("content-type"), PROBLEM_CONTENT_TYPE);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { extra: 1, type: "about:blank", title: "Forbidden", status: 403, detail: "fixed text", code: "host_not_allowed" });
  // Extensions cannot overwrite the standard members.
  assert.deepEqual(await problem(404, "x", "d", { status: 200, type: "https://evil", code: "y" }).json(), { type: "about:blank", title: "Not Found", status: 404, detail: "d", code: "x" });
  assert.equal(new HttpProblem(413, "body_too_large", "d").response.status, 413);
  assert.deepEqual(await internalError().json(), { type: "about:blank", title: "Internal Server Error", status: 500, detail: "the console could not complete this request", code: "internal" });
});

test("proxy.ts applies the rule and exports no matcher (so no path can fall outside it)", async () => {
  const src = readFileSync(join(import.meta.dirname, "..", "proxy.ts"), "utf8");
  assert.doesNotMatch(src, /export\s+const\s+config/);
  const mod = (await import("../proxy.ts")) as Record<string, unknown>;
  assert.equal(mod.config, undefined);
  const proxy = mod.proxy as (r: Request) => Response | undefined;
  assert.equal(proxy(new Request("http://127.0.0.1:3000/", { headers: { host: "127.0.0.1:3000" } })), undefined);
  assert.equal(proxy(new Request("http://127.0.0.1:3000/", { headers: { host: "evil.example" } }))?.status, 403);
});
