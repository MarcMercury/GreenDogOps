import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily rebuild of the Business Development base numbers — the average number
 * of each appointment type per clinic per day, and the average value of those
 * appointments — from the overnight Agenda snapshots and invoice lines.
 *
 * Runs after the ezyVet ingest. Hand-edited cells are preserved and the user's
 * planned scenario is never touched, so the job is idempotent and the duplicate
 * DST-safe cron hour is harmless. CRON_SECRET-gated.
 */
async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bizdev_refresh_metrics");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const stats = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, ...(stats ?? {}) });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
