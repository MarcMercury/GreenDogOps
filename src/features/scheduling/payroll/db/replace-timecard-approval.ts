import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApprovalSnapshot } from "@/lib/payroll/period";

/**
 * Record an approver's sign-off on one employee's timecard for a period.
 * `timecard_approval` rows can be inserted or deleted while the period is
 * open, never updated, so a fresh approval removes the previous row first.
 */
export async function replaceTimecardApproval(input: {
  payPeriodId: string;
  personId: string;
  approvedBy: string;
  snapshot: ApprovalSnapshot;
}): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  // Re-approving replaces the earlier sign-off (allowed while open).
  await admin.from("timecard_approval").delete().eq("pay_period_id", input.payPeriodId).eq("person_id", input.personId);
  const { error } = await admin.from("timecard_approval").insert({
    pay_period_id: input.payPeriodId,
    person_id: input.personId,
    approved_by: input.approvedBy,
    snapshot: input.snapshot,
  });
  return { error: error?.message ?? null };
}
