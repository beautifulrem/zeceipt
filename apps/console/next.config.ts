import type { NextConfig } from "next";
import { MAX_BODY_BYTES } from "./lib/http/body.ts";

const nextConfig: NextConfig = {
  experimental: {
    // Requests that pass through proxy.ts (pages, static files, future Server Action POSTs; not /api/)
    // have their bodies buffered by Next before anything answers. This caps that buffer at our ceiling
    // instead of the default 10 MiB. Past it, Next logs a warning, drops the chunk that crossed it and
    // everything after, and the page sees a truncated body (read in next/dist/server/body-streams.js;
    // measured: a 640 KiB JSON body arrived cut short). It bounds memory; it is not a validation.
    // API routes are outside the proxy and refuse oversize bodies themselves (lib/http/body.ts).
    proxyClientMaxBodySize: MAX_BODY_BYTES,
  },
};

export default nextConfig;
