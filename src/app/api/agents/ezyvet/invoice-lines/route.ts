import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { ingestInvoiceCsvText } from "@/lib/reporting/agent-ingest";
import { readCsvBody } from "@/lib/agents/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Has a given service date already been ingested? `GET ...?date=YYYY-MM-DD`
 * answers `{ ok, date, rows, ingested }`.
 *
 * The daily worker is triggered by GitHub Actions cron, which is best-effort:
 * triggers arrive late or get dropped entirely. The workflow's gate calls this
 * so it can tell "already done, skip" apart from "never ran, do it now" instead
 * of guessing from the wall clock — a guess that silently lost Oct 2–3 2026.
 * CRON_SECRET-gated like the POST below.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date=YYYY-MM-DD required" },
      { status: 400 },
    );
  }
  const { count, error } = await createAdminClient()
    .from("ezyvet_invoice_line")
    .select("id", { count: "exact", head: true })
    .eq("line_date", date);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const rows = count ?? 0;
  return NextResponse.json({ ok: true, date, rows, ingested: rows > 0 });
}

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
