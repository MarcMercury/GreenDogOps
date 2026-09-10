import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { readCsvBody } from "@/lib/agents/http";
import { ingestReportCsvText } from "@/lib/reporting/generic-ingest";
import { REPORT_SPECS } from "@/lib/reporting/report-specs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Agent data sink for every spec-driven ezyVet report (payments, receivables,
 * appointments, clinical, inventory...). The `report` segment is the spec key,
 * e.g. POST /api/agents/ezyvet/report/payment_summary with a gzipped CSV body.
 *
 * The hand-written sinks (invoice-lines, animals, contacts, products, referral,
 * cancelled, agenda) keep their own routes because they feed bespoke schemas.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { report } = await params;
  if (!REPORT_SPECS[report]) {
    return NextResponse.json({ ok: false, error: `unknown report "${report}"` }, { status: 404 });
  }
  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }
  const q = req.nextUrl.searchParams;
  const result = await ingestReportCsvText(report, text, {
    from: q.get("from"),
    to: q.get("to"),
    filename: q.get("filename"),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
