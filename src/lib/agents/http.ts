import "server-only";
import { gunzipSync } from "node:zlib";
import type { NextRequest } from "next/server";

/**
 * Read a CSV request body as text, transparently inflating a gzip payload.
 * The agent worker gzips large exports to stay under the serverless
 * request-body size limit; we detect gzip by its magic bytes (0x1f 0x8b) so it
 * works regardless of whether the platform strips Content-Encoding.
 */
export async function readCsvBody(req: NextRequest): Promise<string> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}
