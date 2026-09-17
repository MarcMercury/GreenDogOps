import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { buildReportingDigest } from "@/lib/reporting/digest";
import { postSlackMessage } from "@/lib/slack/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly reporting digest to the #ops-reporting Slack channel: last week's
 * booked-vs-rendered appointments and cancellations, the latest complete month
 * of revenue, year-to-date numbers by location, and client counts — then a link
 * back to /reporting for the detail.
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
