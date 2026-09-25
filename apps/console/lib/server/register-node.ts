// The Node.js half of `instrumentation.ts` (slice C2, design 3.3.1.1.6.2): boot the server context, or
// exit the process with code 1. Measured on Next.js 16.3.6: when register() throws, `next start` keeps
// listening and answers every request with 500 while retrying the hook, which would look "up" to a
// process manager; so a failed boot must never return.

import { join } from "node:path";
import { bootFailureLines, bootServerContext } from "./context.ts";
import { startReceiptWorker } from "./receipt-worker.ts";

export function registerNode(): void {
  let ctx: ReturnType<typeof bootServerContext>;
  try {
    // process.cwd() is where Next.js runs (apps/console); bundles have no import.meta.dirname.
    ctx = bootServerContext(process.env, { migrationsFolder: join(process.cwd(), "db", "migrations") });
  } catch (err) {
    for (const line of bootFailureLines(err)) process.stderr.write(`${line}\n`);
    process.exit(1);
  }
  // Slice I2 (REQ-CON-11): issue receipts automatically once batches are confirmed. Hot custody only (the console
  // reads the chain through its wallet backend); started, not awaited, so register() returns and requests are served.
  const seconds = ctx.config.autoReceiptsSeconds;
  if (ctx.config.custody.mode === "hot" && seconds > 0) {
    startReceiptWorker({ intervalMs: seconds * 1000 });
    process.stdout.write(`receipts: automatic issuance every ${seconds} s once a batch has ${ctx.config.confirmations} confirmations\n`);
  }
}
