// Reading a JSON request body with one ceiling (slice D1, design 3.3.1.4.1.5).
//
// Konclave's lesson (research R46): "a body with NO Content-Length (chunked, or a dribbling client) was
// read unbounded. Absent is not the same as small." So the ceiling is enforced while reading the stream,
// whatever Content-Length says; a declared length over the ceiling is refused before reading anything.

import { HttpProblem } from "./problem.ts";

/** The largest body any console route reads: 256 KiB (a full 50-item draft is about 120 KiB). */
export const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(req: Request, opts: { maxBytes?: number } = {}): Promise<unknown> {
  const max = opts.maxBytes ?? MAX_BODY_BYTES;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new HttpProblem(415, "unsupported_media_type", "send the body as application/json");
  }
  const tooLarge = () => new HttpProblem(413, "body_too_large", `the body must be at most ${max} bytes`);
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    if (/^\d+$/.test(declared)) {
      await req.body?.cancel();
      throw tooLarge();
    }
    throw new HttpProblem(400, "bad_request", "invalid Content-Length");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpProblem(400, "malformed_json", "the body is not valid UTF-8 JSON");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpProblem(400, "malformed_json", "the body is not valid JSON");
  }
}
