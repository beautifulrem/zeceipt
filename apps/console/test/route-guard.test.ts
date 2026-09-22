// Every API route is guarded (slice D1, review round 1). API routes are outside proxy.ts (so they can
// refuse oversize bodies from the live stream), which makes their own guard the only one: this test
// imports every route file under app/api and calls every exported HTTP method with a foreign Host, and
// every unsafe method with a cross-site origin, expecting the guard's 403 before any handler runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const API = join(import.meta.dirname, "..", "app", "api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : []));
}
type Handler = (req: Request, ctx: unknown) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: "0190a0d6-7e3b-7c61-8d3f-4a2b1c0d9e8f" }) };
const code = async (r: Response) => ((await r.json()) as { code: string }).code;

test("every exported method of every API route refuses a foreign Host, and every unsafe one a cross-site origin", async () => {
  const files = routeFiles(API);
  assert.ok(files.length >= 3, `found ${files.length} route files`);
  let checked = 0;
  for (const f of files) {
    const mod = (await import(pathToFileURL(f).href)) as Record<string, unknown>;
    const exported = METHODS.filter((m) => typeof mod[m] === "function");
    assert.ok(exported.length > 0, `${relative(API, f)} exports no method`);
    for (const m of exported) {
      const handler = mod[m] as Handler;
      const body = m === "GET" || m === "HEAD" ? undefined : "{}";
      const foreign = await handler(new Request("http://127.0.0.1:3000/api/x", { method: m, headers: { host: "evil.example", "content-type": "application/json" }, body }), ctx);
      assert.equal(foreign.status, 403, `${m} ${relative(API, f)} with a foreign Host`);
      assert.equal(await code(foreign), "host_not_allowed");
      if (!["GET", "HEAD", "OPTIONS"].includes(m)) {
        const cross = await handler(new Request("http://127.0.0.1:3000/api/x", { method: m, headers: { host: "127.0.0.1:3000", origin: "http://evil.example", "content-type": "application/json" }, body }), ctx);
        assert.equal(cross.status, 403, `${m} ${relative(API, f)} cross-site`);
        assert.equal(await code(cross), "origin_mismatch");
      }
      checked++;
    }
  }
  assert.ok(checked >= 4, `checked ${checked} methods`);
});
