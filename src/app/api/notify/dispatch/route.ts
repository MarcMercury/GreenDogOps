import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { dispatchPendingDeliveries } from "@/lib/notify/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Every 5 minutes (vercel.json): sends queued notification DMs to Slack.
 * Real sends are gated by SLACK_DM_LIVE / SLACK_DM_TEST_USER_IDS; otherwise
 * deliveries are marked skipped. Recorded as `notification_dispatch` in
 * Admin ▸ Agents when there was something to do.
 */
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await dispatchPendingDeliveries({ trigger: "scheduled" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
