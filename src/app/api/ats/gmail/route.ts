import { NextResponse, type NextRequest } from "next/server";
import { ingestGmailInbox } from "@/lib/ats/gmail";

// googleapis + service-role Supabase need the Node.js runtime; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI extraction per message can be slow; allow a generous budget.
export const maxDuration = 300;

/** True when the request carries the Vercel Cron `Authorization: Bearer` secret. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // local dev with no secret configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

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
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
