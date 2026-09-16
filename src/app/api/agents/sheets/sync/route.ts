import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { runSheetSync } from "@/lib/sheets/sync";

// Service-role writes + outbound Google calls need the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily pull of every connected spreadsheet (HR roster, staff schedule, student
 * grid). Runs on the Vercel cron schedule in vercel.json; can also be triggered
 * by hand with the cron secret:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "$APP_URL/api/agents/sheets/sync?source=hr_roster&force=1"
 *
 * Query params:
 *   source=<key>[,<key>]  limit the run to specific sources
 *   force=1               sync even if Drive says the workbook is unchanged
 */
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const params = req.nextUrl.searchParams;
    const only = params.get("source")?.split(",").map((s) => s.trim()).filter(Boolean);
    const result = await runSheetSync({
      only: only?.length ? only : undefined,
      force: params.get("force") === "1",
      trigger: "scheduled",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
