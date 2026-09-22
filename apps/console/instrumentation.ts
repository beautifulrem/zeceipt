// Next.js calls register() once per server instance, before serving requests, in every runtime. The
// console boots only in the Node.js runtime (better-sqlite3, node:crypto); the Node-only code lives in
// its own module so the Edge compilation never sees it (Next.js instrumentation guide, research log R56).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./lib/server/register-node.ts");
    registerNode();
  }
}
