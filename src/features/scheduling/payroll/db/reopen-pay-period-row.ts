import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Put a locked or exported period back to open, recording who did it and why. */
export async function reopenPayPeriodRow(
  payPeriodId: string,
  reopenedBy: string,
  reason: string,
): Promise<{ error: string | null }> {
  const { error } = await createAdminClient()
    .from("pay_period")
    .update({ status: "open", reopened_at: new Date().toISOString(), reopened_by: reopenedBy, reopen_reason: reason })
    .eq("id", payPeriodId);
  return { error: error?.message ?? null };
}
