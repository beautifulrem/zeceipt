// The console binds loopback by default (slice S1): `next start` and `next dev` listen on 0.0.0.0 unless told otherwise
// (Next.js 16.2.9 CLI; R95), and until sign-in exists the bind address is what keeps other machines out (RSK-24).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the start and dev scripts bind 127.0.0.1 themselves", () => {
  const { scripts } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(scripts.start, "next start -H 127.0.0.1");
  assert.equal(scripts.dev, "next dev -H 127.0.0.1");
});
