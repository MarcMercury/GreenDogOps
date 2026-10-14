import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Invalidate every page that renders schedule data. Grid, Setup and Attendance
 * all read the same `sched_*` tables, and Setup changes (departments, roles)
 * also drive the Daily Capacity area options / rollup and the Planning Guides
 * dropdown, so one helper keeps the set in one place.
 */
export function revalidateSchedulePaths(): void {
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  revalidatePath("/schedule/attendance");
  revalidatePath("/capacity");
  revalidatePath("/planning");
}
