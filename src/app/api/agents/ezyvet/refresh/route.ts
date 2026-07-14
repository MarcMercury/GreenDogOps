import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The full materialized-view rebuild is heavy; give it a generous budget.
export const maxDuration = 800;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Rebuild every ezyVet reporting materialized view (invoice roll-ups,
 * appointment matview, provider/case-owner reports, etc.) via
 * refresh_ezyvet_reporting(). Run by the agent as a dedicated step after the
 * daily uploads so the aggregated Reporting page always catches up. The DB
 * function has statement_timeout=0 (migration 0091) so it never gets cut off.
 * CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const startedAt = Date.now();
  const { error } = await admin.rpc("refresh_ezyvet_reporting");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ms: Date.now() - startedAt });
}
