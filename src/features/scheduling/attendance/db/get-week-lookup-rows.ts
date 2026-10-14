import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { WeekLookupRow } from "@/features/scheduling/attendance/types/lookup-rows";

/**
 * Request-cached week lookup (id → week_start, status). Several HR-profile
 * helpers each re-read this small, stable table per request; `cache()`
 * collapses the duplicates into a single fetch per request without changing
 * the returned data.
 */
export const getWeekLookupRows = cache(async (): Promise<WeekLookupRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("id, week_start, status");
  return (data ?? []) as WeekLookupRow[];
});
