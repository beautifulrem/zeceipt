// The OpenAPI stub (slice D1, WBS 3.3.1.4) describes exactly the built routes: every route file's
// exported methods appear in docs/api/openapi.json, and every documented operation has a route file.
// Also checks the stub's problem codes against the codes the library can emit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP = join(import.meta.dirname, "..");
const spec = JSON.parse(readFileSync(join(APP, "..", "..", "docs", "api", "openapi.json"), "utf8")) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: { Problem: { properties: { code: { description: string } } } } };
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : []));
}

test("every route file's methods are documented, and every documented operation is built", () => {
  assert.equal(spec.openapi, "3.1.0");
  const built = new Set<string>();
  for (const f of routeFiles(join(APP, "app"))) {
    const path = "/" + relative(join(APP, "app"), f).split(sep).slice(0, -1).map((s) => s.replace(/^\[(.+)\]$/, "{$1}")).join("/");
    for (const m of readFileSync(f, "utf8").matchAll(/export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) built.add(`${m[1].toLowerCase()} ${path}`);
  }
  const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)));
  assert.deepEqual([...built].sort(), [...documented].sort());
  // Every route is guarded (test/route-guard.test.ts), so every operation must document the guard's 403.
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      assert.ok(Object.hasOwn((op as { responses: Record<string, unknown> }).responses, "403"), `${m} ${p} documents 403`);
    }
  }
});

test("the documented problem codes are exactly the codes the console emits", () => {
  const src = ["lib/http/guard.ts", "lib/http/body.ts", "lib/http/problem.ts", "lib/http/route.ts", "lib/http/batches.ts", "lib/http/submit.ts", "lib/http/receipts.ts", "lib/http/rates.ts", "lib/http/recipients.ts"].map((f) => readFileSync(join(APP, f), "utf8")).join("\n");
  const emitted = new Set([...src.matchAll(/(?:problem|HttpProblem)\(\s*\d{3},\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const documented = new Set(spec.components.schemas.Problem.properties.code.description.split(/,\s*/));
  assert.deepEqual([...emitted].sort(), [...documented].sort());
});

// Review E1 round 2: the statuses each operation can produce, reviewed against the code, so a status added
// to a route (like the status route's 502) cannot stay undocumented. Every route: 403 (guard), 500 (fixed
// internal), 503 (not_ready). Bodies: 400 malformed/schema, 413, 415. Update this table with the route.
const STATUSES: Record<string, string[]> = {
  "get /api/health": ["200", "403", "503"], // healthResponse never throws: its own 503 is "fail"
  "get /api/batches": ["200", "403", "500", "503"],
  "post /api/batches": ["201", "400", "403", "413", "415", "422", "500", "503"],
  "get /api/batches/{id}": ["200", "403", "404", "500", "503"],
  "post /api/batches/{id}/submit": ["202", "400", "403", "404", "409", "413", "415", "422", "500", "502", "503"],
  "get /api/batches/{id}/status": ["200", "403", "404", "409", "500", "502", "503"],
  "get /api/batches/{id}/receipts": ["200", "403", "404", "500", "503"],
  "post /api/batches/{id}/receipts": ["200", "201", "202", "403", "404", "409", "500", "502", "503"],
  "post /api/batches/{id}/rate-lock": ["201", "403", "404", "409", "500", "502", "503"],
  "get /api/recipients": ["200", "403", "500", "503"],
  "post /api/recipients": ["201", "400", "403", "413", "415", "422", "500", "503"],
  "get /api/recipients/{id}": ["200", "403", "404", "500", "503"],
};

test("each operation documents exactly the statuses its route can produce", () => {
  const documented = Object.fromEntries(Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops).map(([m, op]) => [`${m} ${p}`, Object.keys((op as { responses: Record<string, unknown> }).responses).sort()])));
  assert.deepEqual(Object.keys(documented).sort(), Object.keys(STATUSES).sort());
  for (const [op, statuses] of Object.entries(STATUSES)) assert.deepEqual(documented[op], [...statuses].sort(), op);
});
