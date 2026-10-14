"use server";

import { recordAudit } from "@/lib/auth/session";
import { loadPeriodTimecards } from "@/lib/payroll/server";
import { parseInput } from "@/lib/validation/form";
import { gate } from "@/features/scheduling/payroll/server/payroll-gate";
import { revalidatePayrollPaths } from "@/features/scheduling/payroll/server/revalidate-payroll";
import { timecardSchema } from "@/features/scheduling/payroll/schema/timecard.schema";
import { getPayPeriod } from "@/features/scheduling/payroll/db/get-pay-period";
import { replaceTimecardApproval } from "@/features/scheduling/payroll/db/replace-timecard-approval";
import { deleteTimecardApproval } from "@/features/scheduling/payroll/db/delete-timecard-approval";
import type { PayrollResult } from "@/features/scheduling/payroll/types/payroll-result";

// Timecard approval (checklist item 21, D9). Approvers: Owner, Admin,
// Executive, HR / Manager. Nobody approves their own timecard. Everything is
// audited.

/** The wording for a malformed argument; `parseInput` names the failing field first. */
function inputError(message: string): string {
  return message.startsWith("personId") ? "Unknown employee." : "Unknown pay period.";
}

export async function approveTimecard(periodStart: string, personId: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const input = parseInput(timecardSchema, { personId, periodStart });
  if (!input.ok) return { ok: false, error: inputError(input.error) };
  if (g.current.appUser.person_id === input.data.personId) {
    return { ok: false, error: "You can't approve your own timecard. Ask another approver." };
  }
  const period = await getPayPeriod(input.data.periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is locked." };

  const row = (await loadPeriodTimecards(period)).find((r) => r.person_id === input.data.personId);
  if (!row) return { ok: false, error: "This employee has no time in the period." };
  if (row.blockers.length) return { ok: false, error: `Fix first: ${row.blockers.join("; ")}.` };

  const { error } = await replaceTimecardApproval({
    payPeriodId: period.id,
    personId: input.data.personId,
    approvedBy: g.current.appUser.id,
    snapshot: row.snapshot,
  });
  if (error) return { ok: false, error: `Could not approve: ${error}` };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.timecard_approved",
    entity: "person",
    entityId: input.data.personId,
    summary: `Approved ${row.name}'s timecard for ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start, snapshot: row.snapshot },
  });
  revalidatePayrollPaths();
  return { ok: true, message: `Approved ${row.name}.` };
}

export async function unapproveTimecard(periodStart: string, personId: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const input = parseInput(timecardSchema, { personId, periodStart });
  if (!input.ok) return { ok: false, error: inputError(input.error) };
  const period = await getPayPeriod(input.data.periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is locked." };
  const { deleted, error } = await deleteTimecardApproval(period.id, input.data.personId);
  if (error) return { ok: false, error: `Could not un-approve: ${error}` };
  if (!deleted) return { ok: false, error: "That timecard isn't approved." };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.timecard_unapproved",
    entity: "person",
    entityId: input.data.personId,
    summary: `Un-approved a timecard for ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start },
  });
  revalidatePayrollPaths();
  return { ok: true, message: "Approval removed." };
}
