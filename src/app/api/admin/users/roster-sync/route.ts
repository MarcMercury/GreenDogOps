import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { recordAudit } from "@/lib/auth/session";
import { syncAppUsersToRoster } from "@/lib/admin/user-roster-sync";
import { trackCron } from "@/lib/admin/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily sync for Admin users:
 * - auto-links by unique email where possible
 * - refreshes linked full_name/title from HR roster records
 * - gives active employees/contractors with no login one (role staff, no invite)
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await trackCron(
      "user_roster_sync",
      () => syncAppUsersToRoster({ provisionMissingLogins: true }),
      (r) => ({
        ok: true,
        processed: r.scannedUsers,
        changed: r.updatedUsers + r.provisionedLogins,
        error: r.provisionFailures.length
          ? `${r.provisionFailures.length} login(s) could not be created: ${r.provisionFailures.slice(0, 3).join("; ")}`
          : r.stillMissingLogins > 0
            ? `${r.stillMissingLogins} eligible employee(s) still have no login (over the per-run limit)`
            : null,
        detail: {
          logins: {
            status: r.provisionFailures.length ? "error" : "success",
            provisioned: r.provisionedLogins,
            still_missing: r.stillMissingLogins,
          },
        },
      }),
      { everyRun: true },
    );

    await recordAudit({
      actorId: null,
      actorEmail: "system:cron",
      action: "user.roster_daily_sync",
      entity: "app_user",
      summary: `Daily roster sync updated ${result.updatedUsers} user(s), created ${result.provisionedLogins} login(s)`,
      metadata: {
        scanned_users: result.scannedUsers,
        matched_by_email: result.matchedByEmail,
        refreshed_profiles: result.refreshedProfiles,
        updated_users: result.updatedUsers,
        provisioned_logins: result.provisionedLogins,
        still_missing_logins: result.stillMissingLogins,
        provision_failures: result.provisionFailures,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
