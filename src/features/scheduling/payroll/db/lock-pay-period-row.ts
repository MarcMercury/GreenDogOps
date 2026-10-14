import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Flip an open period to locked. The update is conditioned on `status = open`
 * so two approvers locking at the same moment cannot both succeed: `locked` is
 * false when the row had already changed under us.
 */
export async function lockPayPeriodRow(
  payPeriodId: string,
  lockedBy: string,
): Promise<{ locked: boolean; error: string | null }> {
  const { data, error } = await createAdminClient()
    .from("pay_period")
    .update({ status: "locked", locked_at: new Date().toISOString(), locked_by: lockedBy })
    .eq("id", payPeriodId)
    .eq("status", "open")
    .select("id");
  return { locked: (data?.length ?? 0) > 0, error: error?.message ?? null };
}
