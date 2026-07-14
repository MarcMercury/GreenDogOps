import { NextResponse, type NextRequest } from "next/server";
import { ingestContactCsvText } from "@/lib/reporting/agent-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Agent data sink: accepts a raw ezyVet "Contacts" CSV export (text body) and
 * upserts it into ezyvet_contact (with created/updated change logging). Called
 * by the off-Vercel worker for the daily ezyVet CRM refresh. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await req.text();
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const snapshotDate = req.nextUrl.searchParams.get("snapshot_date");
  const filename = req.nextUrl.searchParams.get("filename") ?? undefined;
  const result = await ingestContactCsvText(text, { filename, snapshotDate });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
