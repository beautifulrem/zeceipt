// A minimal static host for the public receipt page (packages/verify, slice F2b) in the console's live e2e:
// it serves a directory, redirects a directory path without a trailing slash (/r → /r/, as static hosts do;
// the fragment is kept by the browser, RFC 9110 §10.2.2), and records what it was asked for, so a test can
// prove the host never saw a receipt.

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };

export interface StaticSite {
  base: string;
  /** Every request as the host saw it: path and query, and its headers. */
  seen: { url: string; headers: string }[];
  close(): Promise<void>;
}

export async function serveStatic(root: string): Promise<StaticSite> {
  const seen: StaticSite["seen"] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: JSON.stringify(req.headers) });
    const url = new URL(req.url ?? "/", "http://x");
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith("/")) return void res.writeHead(301, { location: `${url.pathname}/` }).end();
      file = join(file, "index.html");
    }
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(() => r())) };
}
