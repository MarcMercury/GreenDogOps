import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared bearer-token gate for cron / worker endpoints.
 *
 * These routes are listed as `isPublic` in the proxy (src/lib/supabase/proxy.ts)
 * so Vercel Cron and the off-Vercel GitHub Actions worker can reach them without
 * a session. The bearer token is therefore the ONLY thing standing between the
 * public internet and service-role database writes, so a missing `CRON_SECRET`
 * must FAIL CLOSED rather than wave the request through.
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization");
  if (!provided) return false;

  const expected = `Bearer ${secret}`;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  return (
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf)
  );
}

/**
 * Same fail-closed bearer check against any shared secret — e.g. the
 * OPS_INBOUND_TASK_SECRET that Slack workflows use for /api/tasks/inbound.
 * A missing or short (< 24 chars) secret rejects every request.
 */
export function hasBearerSecret(req: NextRequest, secret: string | undefined): boolean {
  if (!secret || secret.length < 24) return false;
  const provided = req.headers.get("authorization");
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}
