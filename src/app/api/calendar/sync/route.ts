import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { syncGoogleCalendar } from "@/lib/calendar/sync";

// googleapis needs the Node.js runtime (not edge); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await syncGoogleCalendar();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
