// The shared `IdempotencyStore` contract, run against every implementation.

import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIdempotencyStore, MemoryIdempotencyStore, migrateDb, openDb, SqliteIdempotencyStore } from "../lib/index.ts";
import { storeContract } from "./helpers/store-contract.ts";

storeContract("memory", async () => {
  let t = Date.parse("2026-09-23T00:00:00Z");
  return { store: new MemoryIdempotencyStore({ clock: () => t }), ageClaims: async (_n, _a, ms) => void (t += ms), cleanup: async () => {} };
});

storeContract("file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zeceipt-contract-file-"));
  return {
    store: new FileIdempotencyStore(dir),
    ageClaims: async (nonce, attempt, ms) => {
      const prefix = `${createHash("sha256").update(nonce).digest("hex")}.attempt-${attempt}`;
      for (const f of await readdir(dir)) {
        if (f !== prefix && !f.startsWith(`${prefix}.`)) continue;
        const st = await stat(join(dir, f));
        const older = new Date(st.mtimeMs - ms);
        await utimes(join(dir, f), older, older);
      }
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});

storeContract("sqlite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zeceipt-contract-sqlite-"));
  const db = openDb({ path: join(dir, "console.db") });
  migrateDb(db);
  let t = Date.parse("2026-09-23T00:00:00Z");
  return {
    store: new SqliteIdempotencyStore(db, { orgId: "org-contract", clock: () => t }),
    ageClaims: async (_n, _a, ms) => void (t += ms),
    cleanup: async () => {
      db.$client.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});
