"use server";

import { recordAudit } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { lockBlockers } from "@/lib/payroll/period";
import { loadPeriodTimecards } from "@/lib/payroll/server";
import { parseInput } from "@/lib/validation/form";
import { gate } from "@/features/scheduling/payroll/server/payroll-gate";
import { revalidatePayrollPaths } from "@/features/scheduling/payroll/server/revalidate-payroll";
import { lockPayPeriodSchema, reopenPayPeriodSchema } from "@/features/scheduling/payroll/schema/pay-period.schema";
import { getPayPeriod } from "@/features/scheduling/payroll/db/get-pay-period";
import { lockPayPeriodRow } from "@/features/scheduling/payroll/db/lock-pay-period-row";
import { reopenPayPeriodRow } from "@/features/scheduling/payroll/db/reopen-pay-period-row";
import type { PayrollResult } from "@/features/scheduling/payroll/types/payroll-result";

// Pay-period lock and reopen (checklist item 21, D9). Locking needs every
// timecard approved and clean (`lockBlockers`); reopening a locked period is
// Owner/Admin only and needs a reason. Everything is audited.

/** The wording for a malformed reopen argument; `parseInput` names the failing field first. */
function reopenInputError(message: string): string {
  return message.startsWith("reason") ? "Please give a reason for reopening." : "Unknown pay period.";
}

export async function lockPayPeriod(periodStart: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const input = parseInput(lockPayPeriodSchema, { periodStart });
  if (!input.ok) return { ok: false, error: "Unknown pay period." };
  const period = await getPayPeriod(input.data.periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is already locked." };
  const rows = await loadPeriodTimecards(period);
  const blockers = lockBlockers(rows, period.period_end, todayInWorkTz());
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  const { locked, error } = await lockPayPeriodRow(period.id, g.current.appUser.id);
  if (error) return { ok: false, error: `Could not lock: ${error}` };
  if (!locked) return { ok: false, error: "Someone else changed this period. Refresh and try again." };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.period_locked",
    entity: "pay_period",
    entityId: period.id,
    summary: `Locked pay period ${period.period_start} – ${period.period_end} (${rows.length} timecards)`,
    metadata: { pay_period: period.period_start, timecards: rows.length },
  });
  revalidatePayrollPaths();
  return { ok: true, message: "Locked. You can export it now." };
}

export async function reopenPayPeriod(periodStart: string, reason: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isAdminRole(g.current.appUser.role)) return { ok: false, error: "Only Owners and Admins can reopen a locked period." };
  const input = parseInput(reopenPayPeriodSchema, { periodStart, reason });
  if (!input.ok) return { ok: false, error: reopenInputError(input.error) };
  const why = input.data.reason.trim().slice(0, 500);
  if (!why) return { ok: false, error: "Please give a reason for reopening." };
  const period = await getPayPeriod(input.data.periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status === "open") return { ok: false, error: "This period is already open." };
  const { error } = await reopenPayPeriodRow(period.id, g.current.appUser.id, why);
  if (error) return { ok: false, error: `Could not reopen: ${error}` };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.period_reopened",
    entity: "pay_period",
    entityId: period.id,
    summary: `Reopened pay period ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start, previous_status: period.status, reason: why },
  });
  revalidatePayrollPaths();
  return { ok: true, message: "Reopened. Approvals stay; fix what's needed and lock again." };
}
