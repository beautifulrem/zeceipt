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
  const src = ["lib/http/guard.ts", "lib/http/body.ts", "lib/http/problem.ts", "lib/http/route.ts", "lib/http/batches.ts"].map((f) => readFileSync(join(APP, f), "utf8")).join("\n");
  const emitted = new Set([...src.matchAll(/(?:problem|HttpProblem)\(\s*\d{3},\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const documented = new Set(spec.components.schemas.Problem.properties.code.description.split(/,\s*/));
  assert.deepEqual([...emitted].sort(), [...documented].sort());
});
