import "server-only";
import { revalidatePath } from "next/cache";

/**
 * A decision changes the approver queues, the employee's My Time clock and
 * timecard, and the Work Center counts on the dashboard.
 */
export function revalidateTimeClockPaths(): void {
  revalidatePath("/schedule/time-clock");
  revalidatePath("/me");
  revalidatePath("/me/timecard");
  revalidatePath("/");
}
