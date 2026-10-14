import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { LOCATION_COLUMNS } from "@/lib/shared/locations";
import type { ScheduleLocation } from "@/lib/schedule/types";

/** Active practice locations, ordered for the grid. */
export const getLocations = cache(async (): Promise<ScheduleLocation[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select(LOCATION_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ScheduleLocation[];
});
