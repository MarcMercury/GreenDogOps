import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { buildUpcomingApptsReport } from "@/lib/reporting/upcoming";
import { isUpcomingPostSlot } from "@/lib/reporting/upcoming-schedule";
import { postSlackMessage } from "@/lib/slack/client";
import { recordCronRun } from "@/lib/admin/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Forward-looking appointment report for next calendar week — booked vs offered
 * per clinic, day and track (dental / VE / AP).
 *
 * Posts Monday, Wednesday and Friday at 9 AM Pacific, after the 5 AM Pacific
 * ezyVet Agenda look-ahead pull. vercel.json fires at both 16:00 and 17:00 UTC
 * (DST-safe pair) and only the run landing at 9 AM Pacific posts; `?force=1`
 * bypasses the gate for manual runs. CRON_SECRET-gated; lives under
 * /api/agents/ so the proxy already treats it as self-authenticating.
 */
async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const preview = Boolean(req.nextUrl.searchParams.get("preview"));
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!preview && !force && !isUpcomingPostSlot(new Date())) {
    return NextResponse.json({ ok: true, skipped: true, reason: "not Mon/Wed/Fri 9 AM Pacific" });
  }

  const startedAt = new Date();
  let report: Awaited<ReturnType<typeof buildUpcomingApptsReport>>;
  try {
    report = await buildUpcomingApptsReport();
  } catch (err) {
    if (!preview) {
      const message = err instanceof Error ? err.message : String(err);
      await recordCronRun("reporting_slack_upcoming", startedAt, { ok: false, error: message }, { everyRun: true });
    }
    throw err;
  }
  // ?preview=1 renders the message without posting it, for checking template edits.
  if (preview) {
    return NextResponse.json({ ok: true, preview: true, ...report });
  }

  const posted = await postSlackMessage({
    channelKey: "opsUpcoming",
    text: report.text,
    username: "Green Dog Ops Reporting",
  });
  await recordCronRun(
    "reporting_slack_upcoming",
    startedAt,
    { ok: posted.ok, error: posted.ok ? report.staleWarning : posted.error ?? "Slack post failed.", changed: posted.ok ? 1 : 0 },
    { everyRun: true },
  );
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
