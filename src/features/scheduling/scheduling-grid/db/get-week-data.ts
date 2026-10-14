import "server-only";
import { getWeek } from "@/features/scheduling/scheduling-grid/db/get-week";
import { getWeekDataFor } from "@/features/scheduling/scheduling-grid/db/get-week-data-for";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";

/** Full grid payload for a single week, looked up by id. */
export async function getWeekData(weekId: string): Promise<WeekData | null> {
  const week = await getWeek(weekId);
  if (!week) return null;
  return getWeekDataFor(week);
}
