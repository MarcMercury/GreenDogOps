import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PayrollExportRow } from "@/features/scheduling/payroll/types/payroll-export";

/** The newest export files built for a pay period, most recent first (at most ten). */
export async function getPayrollExports(payPeriodId: string): Promise<PayrollExportRow[]> {
  const { data } = await createAdminClient()
    .from("payroll_export")
    .select("id, format, file_name, file_sha256, employee_count, created_at")
    .eq("pay_period_id", payPeriodId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as PayrollExportRow[];
}
