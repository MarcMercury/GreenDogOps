import { NextResponse, type NextRequest } from "next/server";
import { ingestAgendaCsvText } from "@/lib/schedule/agenda-ingest";
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
 * Agent data sink: accepts a raw ezyVet "Agenda" CSV export (text body,
 * forward-looking) and rebuilds the per-location/day/department booked-
 * appointment counts that drive the Schedule / Daily Capacity look-forward.
 * Called by the off-Vercel worker. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const result = await ingestAgendaCsvText(text);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
