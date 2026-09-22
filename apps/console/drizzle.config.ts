import { defineConfig } from "drizzle-kit";

// `npx drizzle-kit generate` writes SQL migrations for db/schema.ts; they are applied at runtime by
// `migrateDb` (db/client.ts). Migrations are committed and never edited after release.
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
