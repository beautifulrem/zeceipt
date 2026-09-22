// JSON body reading with one ceiling (slice D1): enforced while streaming, whatever Content-Length says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, readJson } from "../lib/http/body.ts";
import { HttpProblem } from "../lib/http/problem.ts";

const req = (body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://127.0.0.1/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
const failsWith = async (p: Promise<unknown>, status: number, code: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof HttpProblem && e.response.status === status && e.message.includes(code));
};
/** A body with no Content-Length that yields `total` bytes in 16 KiB chunks and records how much was pulled. */
function stream(total: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(16 * 1024, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
  return { body, sent: () => sent };
}

test("a JSON body under the ceiling parses; charset parameters are fine", async () => {
  assert.deepEqual(await readJson(req('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJson(req('{"a":1}', { "content-type": "Application/JSON; charset=utf-8" })), { a: 1 });
  assert.deepEqual(await readJson(req(" ".repeat(MAX_BODY_BYTES - 2) + "{}")), {});
});

test("content type must be application/json (415)", async () => {
  await failsWith(readJson(req("{}", { "content-type": "text/plain" })), 415, "unsupported_media_type");
  await failsWith(readJson(req("{}", { "content-type": "application/x-www-form-urlencoded" })), 415, "unsupported_media_type");
  await failsWith(readJson(req("{}", {})), 415, "unsupported_media_type");
});

test("over the ceiling: a declared length is refused before reading; a chunked body is cut off while reading (413)", async () => {
  const declared = stream(MAX_BODY_BYTES * 4);
  await failsWith(readJson(req(declared.body, { "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) })), 413, "body_too_large");
  assert.ok(declared.sent() <= 64 * 1024, `read ${declared.sent()} bytes of a body declared too large`);

  const chunked = stream(MAX_BODY_BYTES * 4);
  await failsWith(readJson(req(chunked.body)), 413, "body_too_large");
  assert.ok(chunked.sent() <= MAX_BODY_BYTES + 64 * 1024, `read ${chunked.sent()} bytes before stopping`);

  // A lying Content-Length (small) does not help: the count is of bytes actually read.
  const liar = stream(MAX_BODY_BYTES * 2);
  await failsWith(readJson(req(liar.body, { "content-type": "application/json", "content-length": "10" })), 413, "body_too_large");
  await failsWith(readJson(req("{}", { "content-type": "application/json", "content-length": "-1" })), 400, "bad_request");
});

test("malformed JSON or invalid UTF-8 (400)", async () => {
  await failsWith(readJson(req("{")), 400, "malformed_json");
  await failsWith(readJson(req("")), 400, "malformed_json");
  await failsWith(readJson(req(new Uint8Array([0x22, 0xff, 0x22]))), 400, "malformed_json");
});
