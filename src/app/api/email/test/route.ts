import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { sendEmail, isEmailConfigured } from "@/lib/shared/email";

// Resend uses fetch (Node runtime is fine); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a test email to confirm Resend is wired up end-to-end.
 *
 * Admin-only. POST a JSON body `{ "to": "you@example.com" }` (defaults to the
 * signed-in admin's own address). Returns the Resend message id on success.
 */
export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current || !isAdminRole(current.appUser.role)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY is not set." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { to?: string };
  const to = body.to?.trim() || current.email;

  const result = await sendEmail({
    to,
    subject: "GreenDog Ops — test email",
    text: "This is a test message from GreenDog Ops. Resend is configured correctly.",
    html:
      "<p>This is a test message from <strong>GreenDog Ops</strong>.</p>" +
      "<p>Resend is configured correctly. ✅</p>",
    tags: [{ name: "type", value: "test" }],
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
