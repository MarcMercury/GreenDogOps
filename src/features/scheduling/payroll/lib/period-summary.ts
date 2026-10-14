import type { PeriodTotals } from "@/lib/payroll/ca-rules";
import type { EmployeePeriod } from "@/lib/payroll/server";

/**
 * Pure rollups over a period's timecards, for the summary card. They read only
 * the fields they name, so the tests (and any other caller) can pass partial
 * rows.
 */

/** The hours buckets the summary tiles add up. */
export type HoursBucket = "regular" | "overtime" | "doubleTime" | "worked";

type CurrentApproval = NonNullable<EmployeePeriod["approval"]>;

/**
 * An approval counts only while it still matches the live totals. A stale one
 * (hours changed since the sign-off) is shown, but neither counted nor
 * accepted for locking.
 */
export function isApproved<T extends Pick<EmployeePeriod, "approval">>(
  row: T,
): row is T & { approval: CurrentApproval } {
  return !!row.approval && !row.approval.stale;
}

/** Timecards whose approval is current. */
export function approvedCount(rows: readonly Pick<EmployeePeriod, "approval">[]): number {
  return rows.filter((r) => isApproved(r)).length;
}

/** Employees the ADP RUN export cannot key yet. */
export function missingRunIdCount(rows: readonly Pick<EmployeePeriod, "adp_employee_id">[]): number {
  return rows.filter((r) => !r.adp_employee_id).length;
}

/** Employees with no FLSA status on file (computed as non-exempt). */
export function unknownFlsaCount(rows: readonly Pick<EmployeePeriod, "flsa">[]): number {
  return rows.filter((r) => r.flsa === "unknown").length;
}

/** Minutes in one bucket, summed across every timecard in the period. */
export function sumTotals(
  rows: readonly { result: { totals: Pick<PeriodTotals, HoursBucket> } }[],
  bucket: HoursBucket,
): number {
  return rows.reduce((n, r) => n + r.result.totals[bucket], 0);
}
