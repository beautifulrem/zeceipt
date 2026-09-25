// Shared by the build-and-serve e2e files: start `next start`, raw HTTP (fetch cannot set Host), and posting a
// page's form as a browser without JavaScript would. Extracted from app.e2e.test.ts for the regtest e2e (E3).

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

export const APP = resolve(import.meta.dirname, "..", "..");
export const NEXT = join(APP, "node_modules", "next", "dist", "bin", "next");
/** Every child started here; the test files kill any still running in `after`. */
export const children: ChildProcess[] = [];

/** The parent environment without any ZECEIPT_* variable (the opt-in flag itself would be refused as unknown). */
export const baseEnv = (): Record<string, string> => {
  const e: Record<string, string> = { NEXT_TELEMETRY_DISABLED: "1" };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ZECEIPT_")) e[k] = v;
  return e;
};

export const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });

export async function start(env: Record<string, string>) {
  const port = await freePort();
  // Next's global types make NODE_ENV required on ProcessEnv; Next sets it itself in the child.
  const child = spawn(process.execPath, [NEXT, "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: APP, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
  return { port, child, exited, output: () => out };
}

/** A raw HTTP/1.1 request (fetch cannot set Host); a stream body is sent chunked, with no Content-Length. */
export function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: string | Iterable<Buffer>) {
  return new Promise<{ status: number; type: string | undefined; location?: string; headers: IncomingHttpHeaders; body: string }>((ok, fail) => {
    const r = httpRequest({ host: "127.0.0.1", port, method, path, headers, timeout: 20_000 }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: res.headers["content-type"], location: res.headers.location, headers: res.headers, body: b }));
      res.on("error", fail);
    });
    r.on("error", fail);
    r.on("timeout", () => r.destroy(new Error(`no answer within 20 s: ${method} ${path}`)));
    if (typeof body === "string") r.end(body);
    else if (body) {
      void (async () => {
        for (const chunk of body) {
          if (r.destroyed) return;
          if (!r.write(chunk)) await new Promise((res) => r.once("drain", res).once("close", res)); // respect backpressure
        }
        r.end();
      })();
    } else r.end();
  });
}

export async function waitHealthy(port: number, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) return;
    } catch {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  assert.fail(`not healthy; output:\n${output()}`);
}

export const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`timed out: ${what}`)), ms).unref())]);

/** The hidden fields of the page's form that contains `marker`, as a browser without JavaScript would post them. */
export function formFields(html: string, marker: string): [string, string][] {
  const form = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]).find((f) => f.includes(marker));
  assert.ok(form, `a form containing ${marker}`);
  const unescape = (v: string) => v.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return [...form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)].map((m) => [unescape(m[1]), unescape(m[2] ?? "")]);
}
export function multipart(fields: [string, string][]) {
  const boundary = `----zeceipt${Date.now()}`;
  const body = fields.map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + `--${boundary}--\r\n`;
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}
