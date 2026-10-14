import "server-only";
import { dateForDay } from "@/lib/schedule/types";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Copy a source week's shift lines, locations, closures, and staffed
 * assignments into an (already-emptied) target week. Work dates are recomputed
 * for the target week and attendance resets to "scheduled". Shared by
 * copyPreviousWeek, applyWeekTemplate and Setup's duplicateTemplate.
 */
export async function cloneWeekContents(
  supabase: DbClient,
  sourceId: string,
  targetId: string,
  targetWeekStart: string,
  meId: string | null,
): Promise<ActionResult> {
  // Copy shift lines, mapping each old line id to its new one.
  const { data: prevLines } = await supabase
    .from("sched_week_line")
    .select("*")
    .eq("week_id", sourceId)
    .order("sort_order");
  const lineRows = (prevLines ?? []) as Record<string, unknown>[];
  const lineIdMap = new Map<string, string>();
  if (lineRows.length > 0) {
    const { data: created, error } = await supabase
      .from("sched_week_line")
      .insert(
        lineRows.map((l) => ({
          week_id: targetId,
          template_id: l.template_id,
          department_id: l.department_id,
          role_id: l.role_id,
          label: l.label,
          start_time: l.start_time,
          end_time: l.end_time,
          sort_order: l.sort_order,
          is_adhoc: l.is_adhoc,
        })),
      )
      .select("id");
    if (error) return { ok: false, error: error.message };
    const newLines = (created ?? []) as { id: string }[];
    lineRows.forEach((l, i) => {
      if (newLines[i]) lineIdMap.set(l.id as string, newLines[i].id);
    });
  }

  // Copy week locations.
  const { data: prevLocs } = await supabase
    .from("sched_week_location")
    .select("location_id, sort_order")
    .eq("week_id", sourceId);
  const locRows = (prevLocs ?? []) as {
    location_id: string;
    sort_order: number;
  }[];
  if (locRows.length > 0)
    await supabase.from("sched_week_location").insert(
      locRows.map((l) => ({
        week_id: targetId,
        location_id: l.location_id,
        sort_order: l.sort_order,
      })),
    );

  // Copy closures.
  const { data: prevClosures } = await supabase
    .from("sched_closure")
    .select("location_id, day_of_week, reason")
    .eq("week_id", sourceId);
  const closureRows = (prevClosures ?? []) as {
    location_id: string;
    day_of_week: number;
    reason: string | null;
  }[];
  if (closureRows.length > 0)
    await supabase.from("sched_closure").insert(
      closureRows.map((c) => ({
        week_id: targetId,
        location_id: c.location_id,
        day_of_week: c.day_of_week,
        reason: c.reason,
      })),
    );

  // Guarantee the standing default — every active location is closed on Sundays
  // (day_of_week 0) — even if the source week had a Sunday re-opened. Ignores
  // duplicates via the (week_id, location_id, day_of_week) unique index.
  const { data: activeLocs } = await supabase
    .from("location")
    .select("id")
    .eq("is_active", true);
  const sundayClosures = ((activeLocs ?? []) as { id: string }[]).map((l) => ({
    week_id: targetId,
    location_id: l.id,
    day_of_week: 0,
    reason: null,
  }));
  if (sundayClosures.length > 0)
    await supabase
      .from("sched_closure")
      .upsert(sundayClosures, {
        onConflict: "week_id,location_id,day_of_week",
        ignoreDuplicates: true,
      });

  // Copy staffed assignments — same people, days, and times — onto the new
  // lines, with work dates recomputed for the target week and attendance reset.
  const { data: prevAsg } = await supabase
    .from("sched_assignment")
    .select("line_id, location_id, person_id, day_of_week")
    .eq("week_id", sourceId)
    .eq("removed_post_publish", false);
  const asgInserts = ((prevAsg ?? []) as {
    line_id: string;
    location_id: string;
    person_id: string;
    day_of_week: number;
  }[])
    .map((a) => {
      const newLineId = lineIdMap.get(a.line_id);
      if (!newLineId) return null;
      return {
        week_id: targetId,
        line_id: newLineId,
        location_id: a.location_id,
        person_id: a.person_id,
        day_of_week: a.day_of_week,
        work_date: dateForDay(targetWeekStart, a.day_of_week),
        created_by: meId,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];
  if (asgInserts.length > 0) {
    const { error } = await supabase
      .from("sched_assignment")
      .insert(asgInserts);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
