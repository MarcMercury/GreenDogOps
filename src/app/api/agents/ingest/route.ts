import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { applyAgentRunUpdate, type AgentRunUpdate } from "@/lib/admin/agent-ingest";

// Service-role Supabase writes need the Node.js runtime; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progress sink for the off-Vercel agent worker. The worker POSTs run status,
 * incremental record/token/cost counters, and log lines here as it works.
 * Gated by CRON_SECRET (same pattern as the calendar/gmail cron routes).
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: AgentRunUpdate;
  try {
    body = (await req.json()) as AgentRunUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const result = await applyAgentRunUpdate(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
