import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { ingestProductCsvText } from "@/lib/reporting/agent-ingest";
import { readCsvBody } from "@/lib/agents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Agent data sink: accepts a raw ezyVet "Products" CSV export (gzipped text
 * body) and upserts the product catalog into ezyvet_product. CRON_SECRET-gated.
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
  const result = await ingestProductCsvText(text, { filename, snapshotDate, importId });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
