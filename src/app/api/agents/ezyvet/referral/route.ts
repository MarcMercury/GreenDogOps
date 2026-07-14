import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestReferralBuffer } from "@/lib/crm/referral-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Agent data sink for the ezyVet referral reports (Referral Statistics — global,
 * and Referrer Revenue — per clinic). Accepts a raw CSV export (text body); the
 * report type is auto-detected from the header. Reuses the exact same
 * clinic-matching, dedup, partner-field-update and recalculate_partner_metrics
 * logic as the manual uploader, so referral contacts' fields are refreshed the
 * same way. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await req.text();
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const filename = req.nextUrl.searchParams.get("filename") ?? "agent-referral.csv";
  const admin = createAdminClient();
  const result = await ingestReferralBuffer(admin, Buffer.from(text, "utf-8"), {
    filename,
    uploadedBy: null,
    dataSource: "agent",
    isXLS: false,
  });
  // Normalize to the shared { inserted, updated, parsed } shape the worker logs.
  const payload = {
    ...result,
    inserted: result.newRows ?? result.updated ?? 0,
    updated: result.updated ?? 0,
    parsed: result.totalRows ?? result.details?.length ?? 0,
  };
  return NextResponse.json(payload, { status: result.ok ? 200 : 400 });
}
