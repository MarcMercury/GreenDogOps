import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canApproveTime } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoDate } from "@/lib/worklist/dates";
import { payPeriodFor } from "@/lib/timeclock/pay-period";
import { ensurePayPeriod, loadReviewSnapshot } from "@/lib/payroll/server";
import { reviewTotals } from "@/lib/payroll/review";
import { ADP_RUN_FORMAT, adpExportBlockers, adpRunCsv, adpSettingsFrom, batchIdFor, reviewSummaryCsv } from "@/lib/payroll/adp-run";

export const runtime = "nodejs";

/** Same-origin form POST only (the same rule Next applies to Server Actions). */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /api/payroll/export (form fields `period` = period start, `kind` =
 * "adp" | "summary") → CSV built ONLY from the period's completed Payroll
 * Review (pay_period.review_snapshot). "adp" is the ADP RUN Time Sheet Import
 * file and marks the period exported; "summary" is the readable copy with
 * names. Every download is recorded (who, when, format, SHA-256).
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const current = await getCurrentUser();
  if (!current || !canApproveTime(current.appUser)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const start = String(form.get("period") ?? "");
  if (!isIsoDate(start) || payPeriodFor(start).start !== start) {
    return NextResponse.json({ ok: false, error: "unknown period" }, { status: 400 });
  }
  const kind = String(form.get("kind") ?? "adp");
  if (kind !== "adp" && kind !== "summary") return NextResponse.json({ ok: false, error: "unknown export" }, { status: 400 });
  const period = await ensurePayPeriod(payPeriodFor(start));
  if (period.status !== "reviewed" && period.status !== "exported") {
    return NextResponse.json(
      { ok: false, error: "Lock the period and complete the Payroll Review before exporting." },
      { status: 409 },
    );
  }
  const lines = await loadReviewSnapshot(period.id);
  if (!lines) return NextResponse.json({ ok: false, error: "This period has no completed review." }, { status: 409 });

  const admin = createAdminClient();
  let csv: string;
  let fileName: string;
  let format: string;
  if (kind === "adp") {
    const { data: rows, error } = await admin.from("app_setting").select("key, value").like("key", "payroll.adp.%");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const settings = adpSettingsFrom(new Map((rows ?? []).map((r) => [r.key as string, r.value as unknown])));
    const blockers = adpExportBlockers(lines, settings);
    if (blockers.length) return NextResponse.json({ ok: false, error: blockers.join(" ") }, { status: 409 });
    csv = adpRunCsv(lines, settings, period.pay_date);
    format = ADP_RUN_FORMAT;
    fileName = `adp-run-timesheet_${period.period_start}_${period.period_end}_batch-${batchIdFor(period.pay_date)}.csv`;
  } else {
    csv = reviewSummaryCsv(lines, period.period_start, period.period_end);
    format = "ops_review_summary_v1";
    fileName = `payroll-review_${period.period_start}_${period.period_end}.csv`;
  }
  const sha = createHash("sha256").update(csv).digest("hex");
  const totals = reviewTotals(lines);

  const { error: logErr } = await admin.from("payroll_export").insert({
    pay_period_id: period.id,
    format,
    file_name: fileName,
    file_sha256: sha,
    employee_count: lines.length,
    totals,
    created_by: current.appUser.id,
  });
  if (logErr) return NextResponse.json({ ok: false, error: `Could not record the export: ${logErr.message}` }, { status: 500 });
  if (kind === "adp" && period.status === "reviewed") {
    await admin.from("pay_period").update({ status: "exported" }).eq("id", period.id).eq("status", "reviewed");
  }
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "payroll.exported",
    entity: "pay_period",
    entityId: period.id,
    summary: `Exported ${period.period_start} – ${period.period_end} (${lines.length} employees, ${format})`,
    metadata: { sha256: sha, totals, format },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
