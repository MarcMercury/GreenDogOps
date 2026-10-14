// Payroll period helpers — pure. Snapshot what an approver signed off on, and
// tell whether it still matches the live timecard.

import type { FlsaClass, PeriodTotals } from "./ca-rules";

export interface ApprovalSnapshot {
  flsa: FlsaClass;
  adp_employee_id: string | null;
  worked: number;
  regular: number;
  overtime: number;
  doubleTime: number;
  mealPremiums: number;
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
  };
}

/** True when the approved snapshot no longer matches what the timecard shows now. */
export function approvalStale(approved: Partial<ApprovalSnapshot> | null, current: ApprovalSnapshot): boolean {
  if (!approved) return false;
  return (Object.keys(current) as (keyof ApprovalSnapshot)[]).some((k) => approved[k] !== current[k]);
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
