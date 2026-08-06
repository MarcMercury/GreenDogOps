import { NextResponse, type NextRequest } from "next/server";
import { ingestAnimalCsvText } from "@/lib/reporting/agent-ingest";
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
 * Agent data sink: accepts a raw ezyVet "Animals" CSV export (gzipped text
 * body) and upserts it into ezyvet_animal. The full snapshot is too large for
 * one request, so the worker posts it in chunks; the first response carries the
 * `importId` that later chunks pass back as `?import_id=` so they share one
 * import record. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const snapshotDate = req.nextUrl.searchParams.get("snapshot_date");
  const importId = req.nextUrl.searchParams.get("import_id");
  const filename = req.nextUrl.searchParams.get("filename") ?? undefined;
  const result = await ingestAnimalCsvText(text, { filename, snapshotDate, importId });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
