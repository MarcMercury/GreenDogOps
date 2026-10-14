import "server-only";
import { createClient } from "@/lib/supabase/server";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import type {
  GuideData,
  PlanningCapacityRule,
  PlanningGuide,
  PlanningGuideColumn,
  PlanningGuideSlot,
} from "@/lib/planning/types";
import type { GuideWithCapacity } from "@/lib/planning/resolve";
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
      .eq("show_in_planning", true)
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

  // Columns and slots filter on guide_id directly, so none of the three waits
  // on the guide row; fetching it first only added a round trip.
  const [guideRes, colRes, slotRes] = await Promise.all([
    supabase.from("planning_guide").select("*").eq("id", guideId).maybeSingle(),
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

  if (!guideRes.data) return null;

  return {
    guide: guideRes.data as PlanningGuide,
    columns: (colRes.data ?? []) as PlanningGuideColumn[],
    slots: (slotRes.data ?? []) as PlanningGuideSlot[],
  };
}

/**
 * Active planning guides enriched with their bookable-slot total, so the
 * schedule can resolve and roll up each staffed day's appointment capacity.
 * Bookable = slots that are not structural (open / block / lunch).
 */
export async function getActiveGuides(): Promise<GuideWithCapacity[]> {
  const supabase = await createClient();
  const [guideRes, colRes, slotRes] = await Promise.all([
    supabase
      .from("planning_guide")
      .select("*")
      .eq("status", "active")
      .order("sort_order")
      .order("name"),
    supabase.from("planning_guide_column").select("id, guide_id"),
    supabase.from("planning_guide_slot").select("guide_id, type_code"),
  ]);

  const guides = (guideRes.data ?? []) as PlanningGuide[];
  const columns = (colRes.data ?? []) as { id: string; guide_id: string }[];
  const slots = (slotRes.data ?? []) as { guide_id: string; type_code: string }[];

  const STRUCTURAL = new Set(["open", "block", "lunch"]);
  const colCount = new Map<string, number>();
  for (const c of columns) colCount.set(c.guide_id, (colCount.get(c.guide_id) ?? 0) + 1);
  const bookable = new Map<string, number>();
  for (const s of slots) {
    if (STRUCTURAL.has(s.type_code)) continue;
    bookable.set(s.guide_id, (bookable.get(s.guide_id) ?? 0) + 1);
  }

  return guides.map((g) => ({
    ...g,
    bookable: bookable.get(g.id) ?? 0,
    columns: colCount.get(g.id) ?? 0,
  }));
}

/**
 * Active self-managed capacity rules (condition → appointment count) that drive
 * the Daily Capacity view and the assumptions behind each area's capacity.
 */
export async function getCapacityRules(): Promise<PlanningCapacityRule[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("planning_capacity_rule")
    .select("*")
    .eq("status", "active")
    .order("sort_order")
    .order("created_at");
  return (data ?? []) as PlanningCapacityRule[];
}
