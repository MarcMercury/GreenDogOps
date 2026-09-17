import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { buildUpcomingApptsReport } from "@/lib/reporting/upcoming";
import { postSlackMessage } from "@/lib/slack/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Forward-looking appointment report for next calendar week — booked vs offered
 * per clinic, day and track (dental / VE / AP).
 *
 * Scheduled Tuesdays and Thursdays (see vercel.json), after the overnight ezyVet
 * Agenda look-ahead pull. CRON_SECRET-gated; lives under /api/agents/ so the
 * proxy already treats it as self-authenticating.
 */
async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const report = await buildUpcomingApptsReport();
  // ?preview=1 renders the message without posting it, for checking template edits.
  if (req.nextUrl.searchParams.get("preview")) {
    return NextResponse.json({ ok: true, preview: true, ...report });
  }

  const posted = await postSlackMessage({
    channelKey: "opsUpcoming",
    text: report.text,
    username: "Green Dog Ops Reporting",
  });
  if (!posted.ok) {
    return NextResponse.json(
      { ok: false, error: posted.error, week: [report.weekStart, report.weekEnd] },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    week: [report.weekStart, report.weekEnd],
    bookedAsOf: report.bookedAsOf,
    channel: posted.channel,
    ts: posted.ts,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
