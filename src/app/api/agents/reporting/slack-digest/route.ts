import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { buildReportingDigest } from "@/lib/reporting/digest";
import { postSlackMessage } from "@/lib/slack/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly reporting digest to the #ops-reporting Slack channel: appointments,
 * revenue and an appointment-type breakdown per clinic for the last complete
 * business week (Mon–Sat) against the business week before it. Sundays are
 * excluded and each clinic is normalized by its own open days, so Sherman Oaks'
 * Mon/Wed/Fri schedule is never compared against a six-day week.
 *
 * Scheduled Mondays (see vercel.json), after the overnight ezyVet ingest and
 * matview refresh. CRON_SECRET-gated; lives under /api/agents/ so the proxy
 * already treats it as self-authenticating.
 */
async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const digest = await buildReportingDigest();
  // ?preview=1 renders the message without posting it, for checking template edits.
  if (req.nextUrl.searchParams.get("preview")) {
    return NextResponse.json({ ok: true, preview: true, ...digest });
  }

  const posted = await postSlackMessage({
    channelKey: "opsReporting",
    text: digest.text,
    username: "Green Dog Ops Reporting",
  });
  if (!posted.ok) {
    return NextResponse.json(
      { ok: false, error: posted.error, week: [digest.weekStart, digest.weekEnd] },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    week: [digest.weekStart, digest.weekEnd],
    asOf: digest.asOf,
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
