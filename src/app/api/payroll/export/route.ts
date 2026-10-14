import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canApproveTime } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoDate } from "@/lib/worklist/dates";
import { payPeriodFor } from "@/lib/timeclock/pay-period";
import { exportTotals, INTERIM_EXPORT_FORMAT, interimExportCsv, type ApprovalSnapshot } from "@/lib/payroll/period";
import { ensurePayPeriod } from "@/lib/payroll/server";

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
 * POST /api/payroll/export (form field `period` = period start) → CSV of the
 * locked period's APPROVED snapshots. Records the export (who, when, SHA-256)
 * and marks the period exported. Interim format until the RUN header is known.
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
  const period = await ensurePayPeriod(payPeriodFor(start));
  if (period.status === "open") {
    return NextResponse.json({ ok: false, error: "Lock the period before exporting." }, { status: 409 });
  }

  const admin = createAdminClient();
  const { data: approvals, error } = await admin
    .from("timecard_approval")
    .select("person_id, snapshot, person:person_id (full_name, first_name, last_name, preferred_name)")
    .eq("pay_period_id", period.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  type Row = {
    person_id: string;
    snapshot: ApprovalSnapshot;
    person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  };
  const lines = ((approvals ?? []) as unknown as Row[]).map((r) => ({
    name:
      [r.person?.preferred_name || r.person?.first_name, r.person?.last_name].filter(Boolean).join(" ") ||
      r.person?.full_name ||
      "Unknown",
    snapshot: r.snapshot,
  }));
  const csv = interimExportCsv(period.period_start, period.period_end, lines);
  const sha = createHash("sha256").update(csv).digest("hex");
  const fileName = `ops-timecards_${period.period_start}_${period.period_end}.csv`;
  const totals = exportTotals(lines);

  const { error: logErr } = await admin.from("payroll_export").insert({
    pay_period_id: period.id,
    format: INTERIM_EXPORT_FORMAT,
    file_name: fileName,
    file_sha256: sha,
    employee_count: lines.length,
    totals,
    created_by: current.appUser.id,
  });
  if (logErr) return NextResponse.json({ ok: false, error: `Could not record the export: ${logErr.message}` }, { status: 500 });
  if (period.status === "locked") {
    await admin.from("pay_period").update({ status: "exported" }).eq("id", period.id).eq("status", "locked");
  }
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "payroll.exported",
    entity: "pay_period",
    entityId: period.id,
    summary: `Exported ${period.period_start} – ${period.period_end} (${lines.length} employees, ${INTERIM_EXPORT_FORMAT})`,
    metadata: { sha256: sha, totals },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
