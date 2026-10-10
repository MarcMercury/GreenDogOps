import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { trackCron } from "@/lib/admin/cron-run";
import { syncGoogleCalendar } from "@/lib/calendar/sync";

// googleapis needs the Node.js runtime (not edge); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await trackCron("calendar_sync", syncGoogleCalendar, (r) => ({
    // One calendar failing (e.g. not shared) while the rest sync is partial.
    ok: r.ok || r.calendars.some((c) => c.ok),
    error: r.error ?? null,
    processed: r.fetched,
    changed: r.inserted + r.removed,
    detail: Object.fromEntries(
      r.calendars.map((c) => [
        c.label,
        { status: c.ok ? "success" : "error", error: c.error, parsed: c.fetched, inserted: c.inserted, updated: c.updated },
      ]),
    ),
  }));
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
