import "server-only";
import { createClient } from "@/lib/supabase/server";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import type {
  GuideData,
  PlanningGuide,
  PlanningGuideColumn,
  PlanningGuideSlot,
} from "@/lib/planning/types";
import type { SchedDepartment } from "@/lib/schedule/types";

export interface PlanningSetup {
  locations: Location[];
  departments: SchedDepartment[];
}

/** Locations + scheduling departments for the guide editor pickers. */
export async function getPlanningSetup(): Promise<PlanningSetup> {
  const supabase = await createClient();
  const [locRes, deptRes] = await Promise.all([
    supabase
      .from("location")
      .select(LOCATION_COLUMNS)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("sched_department")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
  ]);
  return {
    locations: (locRes.data ?? []) as unknown as Location[],
    departments: (deptRes.data ?? []) as SchedDepartment[],
  };
}

/** All guides, ordered for the guide list (active first, then by sort). */
export async function getGuides(): Promise<PlanningGuide[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("planning_guide")
    .select("*")
    .order("status")
    .order("sort_order")
    .order("name");
  return (data ?? []) as PlanningGuide[];
}

/** Full grid payload (guide + columns + slots) for a single guide. */
export async function getGuideData(guideId: string): Promise<GuideData | null> {
  const supabase = await createClient();
  const { data: guide } = await supabase
    .from("planning_guide")
    .select("*")
    .eq("id", guideId)
    .maybeSingle();
  if (!guide) return null;

  const [colRes, slotRes] = await Promise.all([
    supabase
      .from("planning_guide_column")
      .select("*")
      .eq("guide_id", guideId)
      .order("sort_order"),
    supabase
      .from("planning_guide_slot")
      .select("*")
      .eq("guide_id", guideId)
      .order("start_minute")
      .order("sort_order"),
  ]);

  return {
    guide: guide as PlanningGuide,
    columns: (colRes.data ?? []) as PlanningGuideColumn[],
    slots: (slotRes.data ?? []) as PlanningGuideSlot[],
  };
}
