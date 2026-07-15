import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Queue an ezyVet reporting refresh. Returns immediately — it only flags a
 * refresh as requested (request_reporting_refresh, migration 0094). A
 * server-side pg_cron worker (ezyvet_reporting_refresh_worker, runs every
 * minute) performs the heavy materialized-view rebuild with no HTTP gateway in
 * the path, so it can never hit the ~150s gateway timeout that a synchronous
 * refresh_ezyvet_reporting() over HTTP does (see migrations 0092/0094). Called
 * by the agent right after the daily uploads so the aggregated Reporting page
 * reflects the new data within ~1 minute of the agent finishing.
 * CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("request_reporting_refresh");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, queued: true });
}
