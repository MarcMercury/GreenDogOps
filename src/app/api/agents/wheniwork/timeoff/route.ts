import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { syncWhenIWorkTimeOff } from "@/lib/hr/wheniwork";

// Service-role Supabase + outbound fetch need the Node.js runtime; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Parse When I Work time-off notification emails (from noreply@wheniwork.com in
 * the greendogmarcm@gmail.com inbox) and mirror them into person_time_off as
 * pending requests. Runs on the Vercel cron schedule in vercel.json; can also be
 * triggered manually with the cron secret.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncWhenIWorkTimeOff();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
