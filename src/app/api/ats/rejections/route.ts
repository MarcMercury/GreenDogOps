import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { recordAudit } from "@/lib/auth/session";
import { sendDueRejectionEmails } from "@/lib/ats/rejection-sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Send rejection emails whose 48-hour window has passed (Vercel cron). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await sendDueRejectionEmails();
  if (result.due > 0 || result.errors.length > 0) {
    await recordAudit({
      actorId: null,
      actorEmail: "system:cron",
      action: result.errors.length ? "ats.rejection_email_error" : "ats.rejection_email",
      entity: "person",
      summary: `Rejection emails: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
      metadata: { ...result },
    });
  }
  return NextResponse.json({ ok: result.errors.length === 0, ...result });
}
