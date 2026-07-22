import { NextResponse, type NextRequest } from "next/server";
import { ingestCancelledCsvText } from "@/lib/schedule/cancelled-ingest";
import { readCsvBody } from "@/lib/agents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Agent data sink: accepts a raw ezyVet "Canceled Appointments" report export
 * (text body, run from the GDD & MPMV division so it spans all clinics) and
 * rebuilds the stored cancelled appointments for the covered date window. These
 * power the Appointment Review cancels-by-type breakdown. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const result = await ingestCancelledCsvText(text);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
