import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { ingestInvoiceCsvText } from "@/lib/reporting/agent-ingest";
import { readCsvBody } from "@/lib/agents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Agent data sink: accepts a raw ezyVet "Invoice Lines" CSV export (text body)
 * and ingests it into ezyvet_invoice_line, then refreshes the reporting
 * roll-ups. Called by the off-Vercel worker. CRON_SECRET-gated.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const label = req.nextUrl.searchParams.get("label") ?? undefined;
  const filename = req.nextUrl.searchParams.get("filename") ?? undefined;
  const result = await ingestInvoiceCsvText(text, { label, filename });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
