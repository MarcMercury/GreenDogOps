import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { recordAudit } from "@/lib/auth/session";
import { syncAppUsersToRoster } from "@/lib/admin/user-roster-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily sync for Admin users:
 * - auto-links by unique email where possible
 * - refreshes linked full_name/title from HR roster records
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAppUsersToRoster();

    await recordAudit({
      actorId: null,
      actorEmail: "system:cron",
      action: "user.roster_daily_sync",
      entity: "app_user",
      summary: `Daily roster sync updated ${result.updatedUsers} user(s)`,
      metadata: {
        scanned_users: result.scannedUsers,
        matched_by_email: result.matchedByEmail,
        refreshed_profiles: result.refreshedProfiles,
        updated_users: result.updatedUsers,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
