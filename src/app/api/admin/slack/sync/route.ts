import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { runSlackUserSync } from "@/lib/slack/link-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly Slack user sync (vercel.json, after the roster sync): links active
 * employees to Slack accounts by email and flags deactivated Slack accounts.
 * Read-only toward Slack — it never posts anything. Recorded as an agent_run
 * of `slack_user_sync` (Admin ▸ Agents).
 */
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runSlackUserSync({ trigger: "scheduled" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
