import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { recordAudit } from "@/lib/auth/session";
import { ingestGmailInbox } from "@/lib/ats/gmail";

// googleapis + service-role Supabase need the Node.js runtime; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI extraction per message can be slow; allow a generous budget.
export const maxDuration = 300;

/**
 * Poll greendogcareers@gmail.com for new applications (Indeed notifications and
 * direct submissions) and create recruiting profiles. Runs on the Vercel cron
 * schedule in vercel.json; can also be triggered manually with the cron secret.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await ingestGmailInbox();

  // This cron fires every 5 minutes, so only record runs that did something or
  // went wrong — otherwise an expired refresh token looks identical to a quiet
  // inbox and the failure stays invisible until someone notices no applicants.
  const changed = result.created + result.reapplied;
  if (!result.ok || result.errors.length > 0 || changed > 0) {
    await recordAudit({
      actorId: null,
      actorEmail: "system:cron",
      action: result.ok && result.errors.length === 0
        ? "ats.gmail_ingest"
        : "ats.gmail_ingest_error",
      entity: "person",
      summary: result.ok && result.errors.length === 0
        ? `Gmail intake created ${result.created} and re-applied ${result.reapplied} candidate(s)`
        : `Gmail intake failed: ${result.errors[0] ?? "unknown error"}`,
      metadata: {
        scanned: result.scanned,
        created: result.created,
        reapplied: result.reapplied,
        duplicates: result.duplicates,
        skipped: result.skipped,
        errors: result.errors.slice(0, 10),
      },
    });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
