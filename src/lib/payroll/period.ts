// Payroll period helpers — pure. Snapshot what an approver signed off on, and
// tell whether it still matches the live timecard. Build the interim export.

import { hours, type FlsaClass, type PeriodTotals } from "./ca-rules";

export interface ApprovalSnapshot {
  flsa: FlsaClass;
  adp_employee_id: string | null;
  worked: number;
  regular: number;
  overtime: number;
  doubleTime: number;
  mealPremiums: number;
  restPremiums: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function snapshotOf(flsa: FlsaClass, adpId: string | null, t: PeriodTotals): ApprovalSnapshot {
  return {
    flsa,
    adp_employee_id: adpId,
    worked: round2(t.worked),
    regular: round2(t.regular),
    overtime: round2(t.overtime),
    doubleTime: round2(t.doubleTime),
    mealPremiums: t.mealPremiums,
    restPremiums: t.restPremiums,
  };
}

/** True when the approved snapshot no longer matches what the timecard shows now. */
export function approvalStale(approved: Partial<ApprovalSnapshot> | null, current: ApprovalSnapshot): boolean {
  if (!approved) return false;
  return (Object.keys(current) as (keyof ApprovalSnapshot)[]).some((k) => approved[k] !== current[k]);
}

export interface ExportLine {
  name: string;
  snapshot: ApprovalSnapshot;
}

/** Interim export format until the RUN header (checklist #19) is known. */
export const INTERIM_EXPORT_FORMAT = "ops_totals_v1";

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per employee: hours as decimals; premiums as hours (1 per day owed,
 * paid at the regular rate). Not the RUN import layout — that replaces this
 * once the When I Work → RUN header row and RUN pay codes are known.
 */
export function interimExportCsv(periodStart: string, periodEnd: string, lines: readonly ExportLine[]): string {
  const header = [
    "ADP RUN Employee ID",
    "Employee",
    "FLSA",
    "Period start",
    "Period end",
    "Regular hours",
    "Overtime hours (1.5x)",
    "Double-time hours (2x)",
    "Meal premium hours",
    "Rest premium hours",
    "Total worked hours",
  ];
  const rows = [...lines]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((l) => [
      l.snapshot.adp_employee_id ?? "",
      l.name,
      l.snapshot.flsa === "exempt" ? "Exempt" : l.snapshot.flsa === "non_exempt" ? "Non-exempt" : "Unknown",
      periodStart,
      periodEnd,
      hours(l.snapshot.regular).toFixed(2),
      hours(l.snapshot.overtime).toFixed(2),
      hours(l.snapshot.doubleTime).toFixed(2),
      l.snapshot.mealPremiums.toFixed(2),
      l.snapshot.restPremiums.toFixed(2),
      hours(l.snapshot.worked).toFixed(2),
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportTotals(lines: readonly ExportLine[]) {
  const sum = (k: "regular" | "overtime" | "doubleTime" | "worked") =>
    round2(lines.reduce((n, l) => n + hours(l.snapshot[k]), 0));
  return {
    employees: lines.length,
    regular_hours: sum("regular"),
    overtime_hours: sum("overtime"),
    double_time_hours: sum("doubleTime"),
    worked_hours: sum("worked"),
    meal_premiums: lines.reduce((n, l) => n + l.snapshot.mealPremiums, 0),
    rest_premiums: lines.reduce((n, l) => n + l.snapshot.restPremiums, 0),
  };
}

/** Why a period can't be locked yet (empty = ready). */
export function lockBlockers(
  rows: readonly { approval: { stale: boolean } | null }[],
  periodEnd: string,
  today: string,
): string[] {
  const out: string[] = [];
  if (today <= periodEnd) out.push("The period hasn't ended yet.");
  const notApproved = rows.filter((r) => !r.approval).length;
  const stale = rows.filter((r) => r.approval?.stale).length;
  if (notApproved) out.push(`${notApproved} timecard(s) not approved.`);
  if (stale) out.push(`${stale} timecard(s) changed after approval — approve them again.`);
  return out;
}
