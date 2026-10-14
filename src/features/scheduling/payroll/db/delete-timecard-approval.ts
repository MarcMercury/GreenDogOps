import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Withdraw an employee's approval for a period. `deleted` is 0 when there was none to remove. */
export async function deleteTimecardApproval(
  payPeriodId: string,
  personId: string,
): Promise<{ deleted: number; error: string | null }> {
  const { data, error } = await createAdminClient()
    .from("timecard_approval")
    .delete()
    .eq("pay_period_id", payPeriodId)
    .eq("person_id", personId)
    .select("id");
  return { deleted: data?.length ?? 0, error: error?.message ?? null };
}
