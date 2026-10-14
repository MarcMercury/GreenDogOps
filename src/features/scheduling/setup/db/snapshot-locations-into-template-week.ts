import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Snapshot the active locations into a freshly created template week as its
 * week locations, and seed the standing default closures from the same read:
 * Sundays everywhere; Sherman Oaks also Tue/Wed.
 */
export async function snapshotLocationsIntoTemplateWeek(weekId: string): Promise<void> {
  const supabase = await createClient();
  const { data: locs } = await supabase
    .from("location")
    .select("id, short_code, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  const weekLocs = (locs ?? []).map((l: Record<string, unknown>) => ({
    week_id: weekId,
    location_id: l.id,
    sort_order: (l.sort_order as number) ?? 0,
  }));
  if (weekLocs.length > 0)
    await supabase.from("sched_week_location").insert(weekLocs);

  // Default closures: Sundays everywhere; Sherman Oaks also Tue/Wed.
  const defaultClosures = (locs ?? []).flatMap((l: Record<string, unknown>) => {
    const days = [0];
    if ((l.short_code as string | null) === "SO") days.push(2, 3);
    return days.map((day_of_week) => ({
      week_id: weekId,
      location_id: l.id,
      day_of_week,
      reason: null,
    }));
  });
  if (defaultClosures.length > 0)
    await supabase.from("sched_closure").insert(defaultClosures);
}
