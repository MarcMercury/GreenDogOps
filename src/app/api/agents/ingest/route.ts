import { NextResponse, type NextRequest } from "next/server";
import { applyAgentRunUpdate, type AgentRunUpdate } from "@/lib/admin/agent-ingest";

// Service-role Supabase writes need the Node.js runtime; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when the request carries the Vercel Cron `Authorization: Bearer` secret. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // local dev with no secret configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

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
