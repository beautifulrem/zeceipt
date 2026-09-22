// The Node.js half of `instrumentation.ts` (slice C2, design 3.3.1.1.6.2): boot the server context, or
// exit the process with code 1. Measured on Next.js 16.3.6: when register() throws, `next start` keeps
// listening and answers every request with 500 while retrying the hook, which would look "up" to a
// process manager; so a failed boot must never return.

import { join } from "node:path";
import { bootFailureLines, bootServerContext } from "./context.ts";

export function registerNode(): void {
  try {
    // process.cwd() is where Next.js runs (apps/console); bundles have no import.meta.dirname.
    bootServerContext(process.env, { migrationsFolder: join(process.cwd(), "db", "migrations") });
  } catch (err) {
    for (const line of bootFailureLines(err)) process.stderr.write(`${line}\n`);
    process.exit(1);
  }
}
