import "server-only";
import { revalidatePath } from "next/cache";

/** Re-render the Payroll page after an approval, a lock or a reopen. */
export function revalidatePayrollPaths(): void {
  revalidatePath("/schedule/payroll");
}
