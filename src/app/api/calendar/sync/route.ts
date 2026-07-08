import { NextResponse, type NextRequest } from "next/server";
import { syncGoogleCalendar } from "@/lib/calendar/sync";

// googleapis needs the Node.js runtime (not edge); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when the request carries the Vercel Cron `Authorization: Bearer` secret. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // local dev with no secret configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await syncGoogleCalendar();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
