"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import { dateForDay } from "@/lib/schedule/types";
import {
  DVM_COLORS,
  guideDayWindow,
  guideTracksFor,
  planTrackLayout,
  trackBlockWindow,
} from "@/lib/planning/tracks";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import {
  generateGuideFromCapacitySchema,
  generateGuideFromDaySchema,
} from "@/features/scheduling/scheduling-grid/schema/planning-guide.schema";
import { countDayStaffing } from "@/features/scheduling/scheduling-grid/lib/day-staffing";
import { deletePriorAutoGuides } from "@/features/scheduling/scheduling-grid/db/delete-prior-auto-guides";
import { getDayAssignments } from "@/features/scheduling/scheduling-grid/db/get-day-assignments";
import { getDepartmentName } from "@/features/scheduling/scheduling-grid/db/get-department-name";
import { getLocationLabel } from "@/features/scheduling/scheduling-grid/db/get-location-label";
import { getRoleNames } from "@/features/scheduling/scheduling-grid/db/get-role-names";
import { getWeekLineRoles } from "@/features/scheduling/scheduling-grid/db/get-week-line-roles";
import { getWeekStart } from "@/features/scheduling/scheduling-grid/db/get-week-start";
import { insertGuideColumns } from "@/features/scheduling/scheduling-grid/db/insert-guide-columns";
import { insertGuideSlots } from "@/features/scheduling/scheduling-grid/db/insert-guide-slots";
import { insertPlanningGuide } from "@/features/scheduling/scheduling-grid/db/insert-planning-guide";

/**
 * Reverse the old flow: read how many DVMs are staffed for a (location,
 * department, day) and scaffold a matching planning guide — one exam track per
 * doctor plus a shared Urgent Care lane, with a default NAD/UC slot skeleton.
 * The guide is keyed by `dvm_count` so it auto-resolves the next time that
 * staffing level recurs. Returns the new guide id for navigation.
 */
export async function generateGuideFromDay(
  weekId: string,
  day: number,
  locationId: string,
  departmentId: string,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const parsed = parseInput(generateGuideFromDaySchema, {
    weekId,
    day,
    locationId,
    departmentId,
  });
  if (!parsed.ok) return parsed;
  const input = parsed.data;

  const supabase = await createClient();

  // Read the day's full staffing signature for this location: distinct DVMs in
  // the target department, plus location-wide support headcounts by category.
  const [roles, lines, assignments, loc, dept] = await Promise.all([
    getRoleNames(supabase),
    getWeekLineRoles(supabase, input.weekId),
    getDayAssignments(supabase, input.weekId, input.day, input.locationId),
    getLocationLabel(supabase, input.locationId),
    getDepartmentName(supabase, input.departmentId),
  ]);

  const { staffing, dvmCount } = countDayStaffing(
    roles,
    lines,
    assignments,
    input.departmentId,
  );

  const locLabel = loc?.short_code || loc?.name || "Location";
  const deptLabel = dept?.name || "Service";

  // Create the guide shell.
  const START = 540; // 9:00
  const END = 1020; // 17:00
  const LUNCH = 720; // 12:00
  const guide = await insertPlanningGuide(supabase, {
    name: `${locLabel} — ${deptLabel} ${dvmCount}-DVM`,
    location_id: input.locationId,
    department_id: input.departmentId,
    day_model: `${dvmCount}-DVM day (from schedule)`,
    weekdays: [input.day],
    dvm_count: dvmCount,
    tech_count: staffing.tech || null,
    lead_count: staffing.lead || null,
    dental_count: staffing.dental || null,
    da_count: staffing.da || null,
    float_count: staffing.float || null,
    start_minute: START,
    end_minute: END,
    slot_minutes: 30,
    notes: "Generated from the schedule's staffing for this day. Edit the slots to match the day's appointment plan.",
    created_by: gate.current.authId,
  });
  if (guide.error) return { ok: false, error: guide.error.message };
  const guideId = guide.id;

  // One exam column per doctor, plus a shared Urgent Care lane.
  const columnRows = [
    ...Array.from({ length: dvmCount }, (_, i) => ({
      guide_id: guideId,
      name: `DVM ${i + 1} — Exam`,
      color: DVM_COLORS[i % DVM_COLORS.length],
      capacity_note: null as string | null,
      sort_order: i * 10,
    })),
    {
      guide_id: guideId,
      name: "Urgent Care",
      color: "#d97706",
      capacity_note: null as string | null,
      sort_order: dvmCount * 10,
    },
  ];
  const { data: cols, error: cErr } = await insertGuideColumns(supabase, columnRows);
  if (cErr) return { ok: false, error: cErr.message };

  // Skeleton slots: 30-minute NAD blocks per exam track, UC blocks in the UC
  // lane, with a lunch break at noon.
  const slotRows: Record<string, unknown>[] = [];
  for (const col of cols) {
    const isUc = col.name === "Urgent Care";
    for (let t = START; t < END; t += 30) {
      const isLunch = t === LUNCH;
      slotRows.push({
        guide_id: guideId,
        column_id: col.id,
        start_minute: t,
        duration_minutes: 30,
        type_code: isLunch ? "lunch" : isUc ? "uc" : "nad",
        label: isLunch ? "Lunch" : null,
        sort_order: 0,
      });
    }
  }
  if (slotRows.length) {
    await insertGuideSlots(supabase, slotRows);
  }

  revalidatePath("/planning");
  revalidatePath("/schedule");
  return { ok: true, data: { id: guideId } };
}

// ---------------------------------------------------------------------------
// Auto-generate a planning guide from a Daily Capacity tile, sized to the
// appointment number the tile shows. The generated guide is week-scoped
// (source_week_id) and fully editable afterward. The per-department column
// layout mirrors the hand-authored guides (AP / Clinic exam + Urgent Care, IM,
// Exotics), so the base grid reads like a real day the scheduler then tunes.
// ---------------------------------------------------------------------------

/**
 * Generate (or regenerate) a planning guide for a Daily Capacity tile. Reads the
 * day's staffing signature for the (location, department), scaffolds the
 * department's appointment tracks, and fills exactly `targetAppointments`
 * bookable slots (earliest first) so the guide's bookable count matches the
 * tile's capacity number; the rest of the day is left "open" to edit. A target
 * of 0 (no capacity rule yet) fills the whole day. Re-running for the same
 * week / location / department / day replaces the prior auto-generated guide.
 */
export async function generateGuideFromCapacity(
  weekId: string,
  day: number,
  locationId: string,
  departmentId: string,
  targetAppointments: number,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(generateGuideFromCapacitySchema, {
    weekId,
    day,
    locationId,
    departmentId,
    targetAppointments,
  });
  if (!parsed.ok) return parsed;
  const input = parsed.data;

  const supabase = await createClient();

  const [roles, lines, assignments, loc, dept, week] = await Promise.all([
    getRoleNames(supabase),
    getWeekLineRoles(supabase, input.weekId),
    getDayAssignments(supabase, input.weekId, input.day, input.locationId),
    getLocationLabel(supabase, input.locationId),
    getDepartmentName(supabase, input.departmentId),
    getWeekStart(supabase, input.weekId),
  ]);

  const { staffing, dvmCount } = countDayStaffing(
    roles,
    lines,
    assignments,
    input.departmentId,
  );

  const locLabel = loc?.short_code || loc?.name || "Location";
  const deptLabel = dept?.name || "Service";

  // The specific calendar date this guide is for, so the schedule admin knows
  // exactly which day to enter it into ezyVet.
  const dateLabel = week?.week_start
    ? new Date(`${dateForDay(week.week_start, input.day)}T00:00:00`).toLocaleDateString(
        "en-US",
        { weekday: "short", month: "short", day: "numeric" },
      )
    : null;

  const target = Number.isFinite(input.targetAppointments)
    ? Math.max(0, Math.trunc(input.targetAppointments))
    : 0;

  // Remove any prior auto-generated guide for this exact week/loc/dept/day so a
  // regenerate replaces it (cascade drops its columns + slots).
  await deletePriorAutoGuides(supabase, {
    weekId: input.weekId,
    locationId: input.locationId,
    departmentId: input.departmentId,
    day: input.day,
  });

  // Each area books on the house cadence for its location: AP patients are
  // dropped off every 15 minutes through the morning window; NAD/OE sits on the
  // :00/:30 mark; VE is offset to :15/:45 so the two teams' drop-offs never
  // collide; and the shared UC/Tech lane rides the half hour across both.
  const { startMinute: START, endMinute: END } = guideDayWindow(loc?.short_code);
  const genCols = guideTracksFor(deptLabel, dvmCount, {
    locationCode: loc?.short_code,
  });
  const STEP = Math.min(...genCols.map((c) => c.cadence.stepMinutes));

  const { lanes, total: fillCount } = planTrackLayout(genCols, START, END, target);

  const guide = await insertPlanningGuide(supabase, {
    name: `${locLabel} — ${deptLabel} · ${dateLabel ? `${dateLabel} · ` : ""}${fillCount} appt`,
    location_id: input.locationId,
    department_id: input.departmentId,
    day_model: `${dvmCount}-DVM day · ${fillCount} appts${dateLabel ? ` · ${dateLabel}` : ""} (from capacity)`,
    weekdays: [input.day],
    dvm_count: dvmCount,
    tech_count: staffing.tech || null,
    lead_count: staffing.lead || null,
    dental_count: staffing.dental || null,
    da_count: staffing.da || null,
    float_count: staffing.float || null,
    start_minute: START,
    end_minute: END,
    slot_minutes: STEP,
    source_week_id: input.weekId,
    auto_generated: true,
    target_appointments: target > 0 ? target : null,
    notes:
      `Auto-generated from the Daily Capacity tile${dateLabel ? ` for ${dateLabel}` : ""}. The bookable slots match the tile's appointment number — edit the grid to shape the day.`,
    created_by: gate.current.authId,
  });
  if (guide.error) return { ok: false, error: guide.error.message };
  const guideId = guide.id;

  const { data: cols, error: cErr } = await insertGuideColumns(
    supabase,
    genCols.map((c, i) => ({
      guide_id: guideId,
      name: c.name,
      color: c.color,
      capacity_note: null as string | null,
      sort_order: i * 10,
    })),
  );
  if (cErr) return { ok: false, error: cErr.message };

  const orderedCols = cols.sort((a, b) => a.sort_order - b.sort_order);

  const slotRows: Record<string, unknown>[] = [];
  orderedCols.forEach((col, colIdx) => {
    const lane = lanes[colIdx];
    if (!lane) return;
    const bookable = new Set(lane.bookable);
    for (const t of lane.times) {
      slotRows.push({
        guide_id: guideId,
        column_id: col.id,
        start_minute: t,
        duration_minutes: lane.track.cadence.stepMinutes,
        type_code: bookable.has(t) ? lane.track.type : "open",
        label: null,
        sort_order: 0,
      });
    }
    // The team's block (lunch / treatment time) is one slot spanning the gap,
    // so the grid shows why the lane goes quiet.
    const block = trackBlockWindow(lane.track);
    if (block && block[1] > START && block[0] < END) {
      const from = Math.max(block[0], START);
      const to = Math.min(block[1], END);
      slotRows.push({
        guide_id: guideId,
        column_id: col.id,
        start_minute: from,
        duration_minutes: to - from,
        type_code: "lunch",
        label: to - from > 60 ? "Team block" : "Lunch",
        sort_order: -1,
      });
    }
  });
  if (slotRows.length) {
    await insertGuideSlots(supabase, slotRows);
  }

  revalidatePath("/planning");
  revalidatePath("/capacity");
  revalidatePath("/schedule");
  return { ok: true, data: { id: guideId } };
}
