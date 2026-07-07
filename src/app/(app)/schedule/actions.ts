"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, ensureCanEdit } from "@/lib/auth/session";
import type { AttendanceStatus, ScheduleStatus } from "@/lib/schedule/types";
import { dateForDay } from "@/lib/schedule/types";
import { DEFAULT_WEEK_TEMPLATE } from "@/lib/schedule/default-template";
import { classifyRole, emptyStaffing } from "@/lib/planning/resolve";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function int(v: FormDataEntryValue | null, fallback = 0): number {
  const s = str(v);
  if (s == null) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}
function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

async function actor() {
  const current = await getCurrentUser();
  return {
    id: current?.authId ?? null,
    email: current?.email ?? null,
  };
}

function revalidateAll() {
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  revalidatePath("/schedule/attendance");
  // Setup changes (departments, roles) also drive the Daily Capacity area
  // options/rollup and the Planning Guides dropdown.
  revalidatePath("/capacity");
  revalidatePath("/planning");
}

// ===========================================================================
// SETUP — departments
// ===========================================================================

export async function saveDepartment(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")),
    code: str(formData.get("code")),
    color: str(formData.get("color")) ?? "#64748b",
    sort_order: int(formData.get("sort_order")),
    is_active: formData.has("is_active") ? bool(formData.get("is_active")) : true,
    show_in_planning: bool(formData.get("show_in_planning")),
  };
  if (!patch.name) return { ok: false, error: "Department name is required." };

  const { error } = id
    ? await supabase.from("sched_department").update(patch).eq("id", id)
    : await supabase.from("sched_department").insert(patch);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("sched_department").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// SETUP — roles
// ===========================================================================

export async function saveRole(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    department_id: str(formData.get("department_id")),
    name: str(formData.get("name")),
    sort_order: int(formData.get("sort_order")),
    is_active: formData.has("is_active") ? bool(formData.get("is_active")) : true,
  };
  if (!patch.department_id) return { ok: false, error: "Pick a department." };
  if (!patch.name) return { ok: false, error: "Role name is required." };

  const { error } = id
    ? await supabase.from("sched_role").update(patch).eq("id", id)
    : await supabase.from("sched_role").insert(patch);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("sched_role").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Toggle a single (role, person) eligibility cell. Writes the shared
 * `sched_role_member` table so the eligibility matrix, the HR employee
 * profile, and the schedule grid all stay in sync automatically.
 */
export async function toggleRoleMember(
  roleId: string,
  personId: string,
  eligible: boolean,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  if (eligible) {
    const { error } = await supabase
      .from("sched_role_member")
      .upsert(
        { role_id: roleId, person_id: personId },
        { onConflict: "role_id,person_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("sched_role_member")
      .delete()
      .eq("role_id", roleId)
      .eq("person_id", personId);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  revalidatePath("/hr");
  return { ok: true };
}

/** Replace the full member list of a role with the given person ids. */
export async function setRoleMembers(
  roleId: string,
  personIds: string[],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("sched_role_member")
    .delete()
    .eq("role_id", roleId);
  if (delErr) return { ok: false, error: delErr.message };

  if (personIds.length > 0) {
    const rows = personIds.map((pid) => ({ role_id: roleId, person_id: pid }));
    const { error } = await supabase.from("sched_role_member").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Replace the full set of roles a single person is eligible for. This is the
 * person-centric counterpart to {@link setRoleMembers}; both write the same
 * `sched_role_member` table, so editing eligibility from the employee profile
 * and from Schedule → Setup stays in sync automatically.
 */
export async function setPersonRoles(
  personId: string,
  roleIds: string[],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("sched_role_member")
    .delete()
    .eq("person_id", personId);
  if (delErr) return { ok: false, error: delErr.message };

  if (roleIds.length > 0) {
    const rows = roleIds.map((rid) => ({ role_id: rid, person_id: personId }));
    const { error } = await supabase.from("sched_role_member").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  revalidatePath("/hr");
  return { ok: true };
}

/**
 * Set a person's non-shift student flags (Mentor / Coordinator eligibility).
 * These live on `sched_employee_setting` but are never scheduled — they drive
 * which roster members appear in the CRM student Mentor / Coordinator dropdowns.
 * Edited from the same "Shift eligibility" surface (HR profile + Schedule →
 * Setup) so both stay in sync.
 */
export async function setStudentRoleFlags(
  personId: string,
  isMentor: boolean,
  isCoordinator: boolean,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("sched_employee_setting").upsert(
    {
      person_id: personId,
      is_student_mentor: isMentor,
      is_student_coordinator: isCoordinator,
    },
    { onConflict: "person_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  revalidatePath("/hr");
  revalidatePath("/crm");
  return { ok: true };
}

export async function saveShiftTemplate(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    department_id: str(formData.get("department_id")),
    role_id: str(formData.get("role_id")),
    label: str(formData.get("label")),
    start_time: str(formData.get("start_time")),
    end_time: str(formData.get("end_time")),
    sort_order: int(formData.get("sort_order")),
    is_active: formData.has("is_active") ? bool(formData.get("is_active")) : true,
  };
  if (!patch.department_id) return { ok: false, error: "Pick a department." };

  const { error } = id
    ? await supabase.from("sched_shift_template").update(patch).eq("id", id)
    : await supabase.from("sched_shift_template").insert(patch);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteShiftTemplate(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_shift_template")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// SETUP — employee settings
// ===========================================================================

export async function saveEmployeeSetting(
  personId: string,
  weeklyTarget: number,
  isSchedulable: boolean,
  defaultLocationId: string | null,
  eligibleLocationIds: string[] = [],
  availableDays: number[] = [],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("sched_employee_setting").upsert(
    {
      person_id: personId,
      weekly_shift_target: weeklyTarget,
      is_schedulable: isSchedulable,
      default_location_id: defaultLocationId,
      eligible_location_ids: eligibleLocationIds,
      available_days: availableDays,
    },
    { onConflict: "person_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// WEEKS — create + planning guide
// ===========================================================================

/**
 * Create a week and snapshot the active shift templates into week lines and
 * the active locations into week locations (the Planning Guide starting point).
 */
export async function createWeek(weekStart: string): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const me = await actor();

  const { data: existing } = await supabase
    .from("sched_week")
    .select("id")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing) return { ok: true, data: (existing as { id: string }).id };

  const { data: weekRow, error: weekErr } = await supabase
    .from("sched_week")
    .insert({ week_start: weekStart, status: "draft", created_by: me.id })
    .select("id")
    .single();
  if (weekErr) return { ok: false, error: weekErr.message };
  const weekId = (weekRow as { id: string }).id;

  // Snapshot active templates -> week lines.
  const { data: templates } = await supabase
    .from("sched_shift_template")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  const lines = (templates ?? []).map(
    (t: Record<string, unknown>, i: number) => ({
      week_id: weekId,
      template_id: t.id,
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: (t.sort_order as number) ?? i,
    }),
  );
  if (lines.length > 0) await supabase.from("sched_week_line").insert(lines);

  // Snapshot active locations -> week locations.
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

  // Default closures:
  //  - every location closed on Sundays (day_of_week 0)
  //  - Sherman Oaks (SO) also closed on Tuesdays (2) and Wednesdays (3)
  const defaultClosures = (locs ?? []).flatMap(
    (l: Record<string, unknown>) => {
      const days = [0];
      if ((l.short_code as string | null) === "SO") days.push(2, 3);
      return days.map((day_of_week) => ({
        week_id: weekId,
        location_id: l.id,
        day_of_week,
        reason: null,
      }));
    },
  );
  if (defaultClosures.length > 0)
    await supabase.from("sched_closure").insert(defaultClosures);

  revalidateAll();
  return { ok: true, data: weekId };
}

/**
 * Create a week by cloning the most recent prior week: copies its shift lines,
 * locations, closures, and every staffed assignment (same people, days, and
 * times) into the new week. Attendance is reset to "scheduled". If the target
 * week already exists it is rebuilt from the previous week.
 */
export async function copyPreviousWeek(
  weekStart: string,
): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const me = await actor();

  // Most recent existing week strictly before the new start date.
  const { data: prev } = await supabase
    .from("sched_week")
    .select("id")
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prev)
    return { ok: false, error: "There is no previous week to copy from." };
  const prevId = (prev as { id: string }).id;

  // Create the target week, or wipe an existing one so the copy is clean.
  const { data: existing } = await supabase
    .from("sched_week")
    .select("id")
    .eq("week_start", weekStart)
    .maybeSingle();

  let weekId: string;
  if (existing) {
    weekId = (existing as { id: string }).id;
    await supabase.from("sched_assignment").delete().eq("week_id", weekId);
    await supabase.from("sched_closure").delete().eq("week_id", weekId);
    await supabase.from("sched_week_location").delete().eq("week_id", weekId);
    await supabase.from("sched_week_line").delete().eq("week_id", weekId);
  } else {
    const { data: weekRow, error: weekErr } = await supabase
      .from("sched_week")
      .insert({ week_start: weekStart, status: "draft", created_by: me.id })
      .select("id")
      .single();
    if (weekErr) return { ok: false, error: weekErr.message };
    weekId = (weekRow as { id: string }).id;
  }

  // Copy shift lines, mapping each old line id to its new one.
  const { data: prevLines } = await supabase
    .from("sched_week_line")
    .select("*")
    .eq("week_id", prevId)
    .order("sort_order");
  const lineRows = (prevLines ?? []) as Record<string, unknown>[];
  const lineIdMap = new Map<string, string>();
  if (lineRows.length > 0) {
    const { data: created, error } = await supabase
      .from("sched_week_line")
      .insert(
        lineRows.map((l) => ({
          week_id: weekId,
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
    .eq("week_id", prevId);
  const locRows = (prevLocs ?? []) as {
    location_id: string;
    sort_order: number;
  }[];
  if (locRows.length > 0)
    await supabase.from("sched_week_location").insert(
      locRows.map((l) => ({
        week_id: weekId,
        location_id: l.location_id,
        sort_order: l.sort_order,
      })),
    );

  // Copy closures.
  const { data: prevClosures } = await supabase
    .from("sched_closure")
    .select("location_id, day_of_week, reason")
    .eq("week_id", prevId);
  const closureRows = (prevClosures ?? []) as {
    location_id: string;
    day_of_week: number;
    reason: string | null;
  }[];
  if (closureRows.length > 0)
    await supabase.from("sched_closure").insert(
      closureRows.map((c) => ({
        week_id: weekId,
        location_id: c.location_id,
        day_of_week: c.day_of_week,
        reason: c.reason,
      })),
    );

  // Copy staffed assignments — same people, days, and times — onto the new
  // lines, with work dates recomputed for the new week and attendance reset.
  const { data: prevAsg } = await supabase
    .from("sched_assignment")
    .select("line_id, location_id, person_id, day_of_week")
    .eq("week_id", prevId)
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
        week_id: weekId,
        line_id: newLineId,
        location_id: a.location_id,
        person_id: a.person_id,
        day_of_week: a.day_of_week,
        work_date: dateForDay(weekStart, a.day_of_week),
        created_by: me.id,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];
  if (asgInserts.length > 0) {
    const { error } = await supabase
      .from("sched_assignment")
      .insert(asgInserts);
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true, data: weekId };
}

export async function setWeekLocations(
  weekId: string,
  locationIds: string[],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  await supabase.from("sched_week_location").delete().eq("week_id", weekId);
  if (locationIds.length > 0) {
    const rows = locationIds.map((id, i) => ({
      week_id: weekId,
      location_id: id,
      sort_order: i * 10,
    }));
    const { error } = await supabase.from("sched_week_location").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Resolve the role id for a week line: use an existing role id when provided,
 * otherwise create a new role in the department from a typed name.
 */
async function resolveRoleId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  departmentId: string,
  roleId: string | null,
  newRoleName: string | null,
): Promise<{ id: string | null } | { error: string }> {
  if (roleId) return { id: roleId };
  if (!newRoleName) return { id: null };
  const { data, error } = await supabase
    .from("sched_role")
    .insert({ department_id: departmentId, name: newRoleName, sort_order: 9999 })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Add an ad-hoc shift line to a week (not derived from a template). */
export async function addWeekLine(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const weekId = str(formData.get("week_id"));
  const departmentId = str(formData.get("department_id"));
  if (!weekId || !departmentId)
    return { ok: false, error: "Missing week or department." };

  const role = await resolveRoleId(
    supabase,
    departmentId,
    str(formData.get("role_id")),
    str(formData.get("new_role_name")),
  );
  if ("error" in role) return { ok: false, error: role.error };

  const { error } = await supabase.from("sched_week_line").insert({
    week_id: weekId,
    department_id: departmentId,
    role_id: role.id,
    label: str(formData.get("label")),
    start_time: str(formData.get("start_time")),
    end_time: str(formData.get("end_time")),
    sort_order: int(formData.get("sort_order"), 9999),
    is_adhoc: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Edit an existing shift line on a week's grid. */
export async function updateWeekLine(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const departmentId = str(formData.get("department_id"));
  if (!id) return { ok: false, error: "Missing line id." };
  if (!departmentId) return { ok: false, error: "Pick a department." };

  const role = await resolveRoleId(
    supabase,
    departmentId,
    str(formData.get("role_id")),
    str(formData.get("new_role_name")),
  );
  if ("error" in role) return { ok: false, error: role.error };

  const { error } = await supabase
    .from("sched_week_line")
    .update({
      department_id: departmentId,
      role_id: role.id,
      label: str(formData.get("label")),
      start_time: str(formData.get("start_time")),
      end_time: str(formData.get("end_time")),
      sort_order: int(formData.get("sort_order"), 9999),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function removeWeekLine(lineId: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_week_line")
    .delete()
    .eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Add the active shift templates that are not yet present as lines (used to
 * (re)build the planning guide for a week from Setup).
 */
export async function syncWeekLinesFromTemplates(
  weekId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const [{ data: lines }, { data: templates }] = await Promise.all([
    supabase.from("sched_week_line").select("template_id").eq("week_id", weekId),
    supabase
      .from("sched_shift_template")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  const have = new Set(
    ((lines ?? []) as { template_id: string | null }[])
      .map((l) => l.template_id)
      .filter(Boolean) as string[],
  );
  const toAdd = (templates ?? [])
    .filter((t: Record<string, unknown>) => !have.has(t.id as string))
    .map((t: Record<string, unknown>) => ({
      week_id: weekId,
      template_id: t.id,
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: (t.sort_order as number) ?? 0,
    }));
  if (toAdd.length > 0) {
    const { error } = await supabase.from("sched_week_line").insert(toAdd);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Apply the standard default week template: ensure the canonical departments,
 * roles, and shift lines exist (seeded once), then copy them into the week.
 * Safe to click repeatedly — existing template lines are not duplicated.
 */
export async function applyDefaultTemplate(
  weekId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  // 1. Ensure every template department exists.
  const { data: existingDepts } = await supabase
    .from("sched_department")
    .select("id, name");
  const deptByName = new Map(
    ((existingDepts ?? []) as { id: string; name: string }[]).map((d) => [
      d.name.toLowerCase(),
      d.id,
    ]),
  );
  const deptInserts = DEFAULT_WEEK_TEMPLATE.filter(
    (d) => !deptByName.has(d.name.toLowerCase()),
  ).map((d, i) => ({
    name: d.name,
    color: d.color,
    sort_order: (DEFAULT_WEEK_TEMPLATE.indexOf(d) + 1) * 10 + i,
  }));
  if (deptInserts.length > 0) {
    const { data: created, error } = await supabase
      .from("sched_department")
      .insert(deptInserts)
      .select("id, name");
    if (error) return { ok: false, error: error.message };
    for (const d of (created ?? []) as { id: string; name: string }[])
      deptByName.set(d.name.toLowerCase(), d.id);
  }

  // Only seed roles + shift templates the first time (no templates yet).
  const { count } = await supabase
    .from("sched_shift_template")
    .select("id", { count: "exact", head: true });
  const alreadySeeded = (count ?? 0) > 0;

  if (!alreadySeeded) {
    const deptIds = DEFAULT_WEEK_TEMPLATE.map((d) =>
      deptByName.get(d.name.toLowerCase()),
    ).filter(Boolean) as string[];

    // 2. Ensure one role per (department, role name).
    const { data: existingRoles } = await supabase
      .from("sched_role")
      .select("id, department_id, name")
      .in("department_id", deptIds);
    const roleKey = (deptId: string, name: string) =>
      `${deptId}|${name.toLowerCase()}`;
    const roleMap = new Map(
      (
        (existingRoles ?? []) as {
          id: string;
          department_id: string;
          name: string;
        }[]
      ).map((r) => [roleKey(r.department_id, r.name), r.id]),
    );

    const roleInserts: {
      department_id: string;
      name: string;
      sort_order: number;
    }[] = [];
    for (const dept of DEFAULT_WEEK_TEMPLATE) {
      const deptId = deptByName.get(dept.name.toLowerCase());
      if (!deptId) continue;
      let order = 0;
      const seen = new Set<string>();
      for (const line of dept.lines) {
        const key = roleKey(deptId, line.role);
        if (seen.has(line.role.toLowerCase()) || roleMap.has(key)) continue;
        seen.add(line.role.toLowerCase());
        roleInserts.push({
          department_id: deptId,
          name: line.role,
          sort_order: order++ * 10,
        });
      }
    }
    if (roleInserts.length > 0) {
      const { data: createdRoles, error } = await supabase
        .from("sched_role")
        .insert(roleInserts)
        .select("id, department_id, name");
      if (error) return { ok: false, error: error.message };
      for (const r of (createdRoles ?? []) as {
        id: string;
        department_id: string;
        name: string;
      }[])
        roleMap.set(roleKey(r.department_id, r.name), r.id);
    }

    // 3. Insert the shift templates (intentional duplicates preserved).
    const tplInserts: Record<string, unknown>[] = [];
    let sort = 0;
    for (const dept of DEFAULT_WEEK_TEMPLATE) {
      const deptId = deptByName.get(dept.name.toLowerCase());
      if (!deptId) continue;
      for (const line of dept.lines) {
        tplInserts.push({
          department_id: deptId,
          role_id: roleMap.get(roleKey(deptId, line.role)) ?? null,
          label: null,
          start_time: line.start,
          end_time: line.end,
          sort_order: sort++,
          is_active: true,
        });
      }
    }
    if (tplInserts.length > 0) {
      const { error } = await supabase
        .from("sched_shift_template")
        .insert(tplInserts);
      if (error) return { ok: false, error: error.message };
    }
  }

  // 4. Copy the active templates into this week.
  return syncWeekLinesFromTemplates(weekId);
}

// ===========================================================================
// CLOSURES
// ===========================================================================

export async function toggleClosure(
  weekId: string,
  locationId: string,
  dayOfWeek: number,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("sched_closure")
    .select("id")
    .eq("week_id", weekId)
    .eq("location_id", locationId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("sched_closure")
      .delete()
      .eq("id", (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("sched_closure").insert({
      week_id: weekId,
      location_id: locationId,
      day_of_week: dayOfWeek,
    });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// EVENTS — per location/day banner notes above the grid
// ===========================================================================

/** Set (or clear, when title is blank) the event note for a location/day cell. */
export async function setEvent(
  weekId: string,
  locationId: string,
  dayOfWeek: number,
  title: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const clean = title.trim();

  const { data: existing } = await supabase
    .from("sched_event")
    .select("id")
    .eq("week_id", weekId)
    .eq("location_id", locationId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (!clean) {
    if (existing) {
      const { error } = await supabase
        .from("sched_event")
        .delete()
        .eq("id", (existing as { id: string }).id);
      if (error) return { ok: false, error: error.message };
    }
    revalidateAll();
    return { ok: true };
  }

  const { error } = existing
    ? await supabase
        .from("sched_event")
        .update({ title: clean })
        .eq("id", (existing as { id: string }).id)
    : await supabase.from("sched_event").insert({
        week_id: weekId,
        location_id: locationId,
        day_of_week: dayOfWeek,
        title: clean,
      });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// ASSIGNMENTS — the grid
// ===========================================================================

async function logChange(
  weekId: string,
  action: string,
  detail: string,
  personId: string | null,
  assignmentId: string | null,
) {
  const supabase = await createClient();
  const me = await actor();
  await supabase.from("sched_change_log").insert({
    week_id: weekId,
    assignment_id: assignmentId,
    person_id: personId,
    action,
    detail,
    actor_id: me.id,
    actor_email: me.email,
  });
}

/** Place a person into a (line, location, day) cell. */
export async function assignPerson(
  weekId: string,
  lineId: string,
  locationId: string,
  dayOfWeek: number,
  personId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const me = await actor();

  const { data: week } = await supabase
    .from("sched_week")
    .select("week_start, status")
    .eq("id", weekId)
    .single();
  if (!week) return { ok: false, error: "Week not found." };
  const isPublished = (week as { status: ScheduleStatus }).status === "published";
  const workDate = dateForDay(
    (week as { week_start: string }).week_start,
    dayOfWeek,
  );

  // Already in this exact cell? No-op.
  const { data: dupe } = await supabase
    .from("sched_assignment")
    .select("id")
    .eq("line_id", lineId)
    .eq("location_id", locationId)
    .eq("day_of_week", dayOfWeek)
    .eq("person_id", personId)
    .eq("removed_post_publish", false)
    .maybeSingle();
  if (dupe) return { ok: true };

  const { data: row, error } = await supabase
    .from("sched_assignment")
    .insert({
      week_id: weekId,
      line_id: lineId,
      location_id: locationId,
      person_id: personId,
      day_of_week: dayOfWeek,
      work_date: workDate,
      added_post_publish: isPublished,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (isPublished) {
    // A relocation resolves any auto-absence recorded earlier the same day.
    await supabase
      .from("sched_assignment")
      .update({
        auto_absent: false,
        attendance_status: "scheduled",
        attendance_note: "Relocated — auto-absence cleared.",
      })
      .eq("week_id", weekId)
      .eq("person_id", personId)
      .eq("work_date", workDate)
      .eq("auto_absent", true);

    await logChange(
      weekId,
      "added",
      "Added after publish",
      personId,
      (row as { id: string }).id,
    );
  }

  revalidateAll();
  return { ok: true };
}

/**
 * Remove a person from a cell. On a published week this applies the absence
 * rules: if the person has no other shift that day it becomes an auto-absence
 * (kept + flagged); otherwise it is a relocation and the row is deleted.
 */
export async function removeAssignment(
  assignmentId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const { data: asg } = await supabase
    .from("sched_assignment")
    .select(
      "id, week_id, person_id, work_date, attendance_status, added_post_publish",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (!asg) return { ok: true };
  const a = asg as {
    id: string;
    week_id: string;
    person_id: string;
    work_date: string;
    attendance_status: AttendanceStatus;
    added_post_publish: boolean;
  };

  const { data: week } = await supabase
    .from("sched_week")
    .select("status")
    .eq("id", a.week_id)
    .single();
  const isPublished =
    (week as { status: ScheduleStatus } | null)?.status === "published";

  // Draft week, or a row that was itself added post-publish: just delete it.
  if (!isPublished || a.added_post_publish) {
    const { error } = await supabase
      .from("sched_assignment")
      .delete()
      .eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    if (isPublished)
      await logChange(a.week_id, "removed", "Removed after publish", a.person_id, null);
    revalidateAll();
    return { ok: true };
  }

  // Does the person still have another active shift the same day?
  const { data: others } = await supabase
    .from("sched_assignment")
    .select("id")
    .eq("week_id", a.week_id)
    .eq("person_id", a.person_id)
    .eq("work_date", a.work_date)
    .eq("removed_post_publish", false)
    .neq("id", assignmentId);
  const relocated = (others ?? []).length > 0;

  if (relocated) {
    const { error } = await supabase
      .from("sched_assignment")
      .delete()
      .eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    await logChange(
      a.week_id,
      "relocated",
      "Removed but working elsewhere that day",
      a.person_id,
      null,
    );
  } else {
    const { error } = await supabase
      .from("sched_assignment")
      .update({
        removed_post_publish: true,
        auto_absent: true,
        attendance_status: "absent",
        attendance_note: "Auto-absence: removed after publish, not relocated.",
      })
      .eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    await logChange(
      a.week_id,
      "auto_absent",
      "Auto-marked absent (removed after publish)",
      a.person_id,
      assignmentId,
    );
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Move an existing assignment to a different (line, location, day) cell.
 * Drives the drag-and-drop interaction. All mutations run behind the same
 * `ensureCanEdit("schedule")` gate as the rest of the grid, and the source
 * assignment is re-validated server-side so a client can never relocate a row
 * it has no business touching.
 *
 * On a draft week the row is simply re-pointed at the target cell. On a
 * published week the move is delegated to the existing publish-aware
 * `assignPerson` / `removeAssignment` helpers so absence/relocation rules and
 * the change log stay consistent with manual edits.
 */
export async function moveAssignment(
  assignmentId: string,
  targetLineId: string,
  targetLocationId: string,
  targetDay: number,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  // Re-load the source row server-side — never trust client-supplied context.
  const { data: src } = await supabase
    .from("sched_assignment")
    .select(
      "id, week_id, line_id, location_id, day_of_week, person_id, removed_post_publish, added_post_publish",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (!src) return { ok: false, error: "Assignment not found." };
  const a = src as {
    id: string;
    week_id: string;
    line_id: string;
    location_id: string;
    day_of_week: number;
    person_id: string;
    removed_post_publish: boolean;
    added_post_publish: boolean;
  };

  // A row already removed post-publish is an absence record, not a live shift.
  if (a.removed_post_publish)
    return { ok: false, error: "That assignment is no longer active." };

  // No-op if dropped back onto its own cell.
  if (
    a.line_id === targetLineId &&
    a.location_id === targetLocationId &&
    a.day_of_week === targetDay
  )
    return { ok: true };

  const { data: week } = await supabase
    .from("sched_week")
    .select("week_start, status")
    .eq("id", a.week_id)
    .single();
  if (!week) return { ok: false, error: "Week not found." };
  const w = week as { week_start: string; status: ScheduleStatus };
  const isPublished = w.status === "published";

  // Validate the target line + location actually belong to this week so a
  // crafted request can't relocate someone onto an unrelated week/shift.
  const { data: targetLine } = await supabase
    .from("sched_week_line")
    .select("id")
    .eq("id", targetLineId)
    .eq("week_id", a.week_id)
    .maybeSingle();
  if (!targetLine) return { ok: false, error: "Invalid target shift." };

  const targetDate = dateForDay(w.week_start, targetDay);

  // Already an active row for this person in the target cell? Treat the drag
  // as a consolidation: drop the source so we don't create a duplicate.
  const { data: dupe } = await supabase
    .from("sched_assignment")
    .select("id")
    .eq("line_id", targetLineId)
    .eq("location_id", targetLocationId)
    .eq("day_of_week", targetDay)
    .eq("person_id", a.person_id)
    .eq("removed_post_publish", false)
    .neq("id", a.id)
    .maybeSingle();

  // Draft week (or a row added after publish): re-point the row in place,
  // preserving its history. If it would collide with an existing row, delete
  // the source instead.
  if (!isPublished || a.added_post_publish) {
    if (dupe) {
      const { error } = await supabase
        .from("sched_assignment")
        .delete()
        .eq("id", a.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase
        .from("sched_assignment")
        .update({
          line_id: targetLineId,
          location_id: targetLocationId,
          day_of_week: targetDay,
          work_date: targetDate,
        })
        .eq("id", a.id);
      if (error) return { ok: false, error: error.message };
      if (isPublished)
        await logChange(
          a.week_id,
          "relocated",
          "Moved via drag-and-drop",
          a.person_id,
          a.id,
        );
    }
    revalidateAll();
    return { ok: true };
  }

  // Published week, original row: delegate to the publish-aware helpers so the
  // target gets a properly flagged add and the source applies relocation /
  // auto-absence rules and change-log entries exactly like a manual edit.
  const placed = await assignPerson(
    a.week_id,
    targetLineId,
    targetLocationId,
    targetDay,
    a.person_id,
  );
  if (!placed.ok) return placed;
  return removeAssignment(a.id);
}

/** Mark attendance for an assignment (post-publish). */
export async function markAttendance(
  assignmentId: string,
  status: AttendanceStatus,
  note: string | null,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const me = await actor();

  const { data: asg } = await supabase
    .from("sched_assignment")
    .select("week_id, person_id")
    .eq("id", assignmentId)
    .maybeSingle();

  const { error } = await supabase
    .from("sched_assignment")
    .update({
      attendance_status: status,
      attendance_note: note,
      attendance_marked_by: me.id,
      attendance_marked_at: new Date().toISOString(),
      auto_absent: false,
    })
    .eq("id", assignmentId);
  if (error) return { ok: false, error: error.message };

  if (asg) {
    const a = asg as { week_id: string; person_id: string };
    await logChange(a.week_id, "attendance", `Marked ${status}`, a.person_id, assignmentId);
  }
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// WORKFLOW — submit / approve / publish
// ===========================================================================

export async function setWeekStatus(
  weekId: string,
  status: ScheduleStatus,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const me = await actor();
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = { status };
  if (status === "pending_approval") {
    patch.submitted_by = me.id;
    patch.submitted_at = now;
  } else if (status === "approved") {
    patch.approved_by = me.id;
    patch.approved_at = now;
  } else if (status === "published") {
    patch.published_by = me.id;
    patch.published_at = now;
  } else if (status === "draft") {
    patch.submitted_at = null;
    patch.approved_at = null;
  }

  const { error } = await supabase
    .from("sched_week")
    .update(patch)
    .eq("id", weekId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function updateWeekMeta(
  weekId: string,
  title: string | null,
  notes: string | null,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_week")
    .update({ title, notes })
    .eq("id", weekId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteWeek(weekId: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("sched_week").delete().eq("id", weekId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// PLANNING GUIDE — generate from a scheduled day's staffing
// ===========================================================================

const DVM_COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#16a34a"];

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
  const supabase = await createClient();

  // Read the day's full staffing signature for this location: distinct DVMs in
  // the target department, plus location-wide support headcounts by category.
  const [roleRes, lineRes, asgRes, locRes, deptRes] = await Promise.all([
    supabase.from("sched_role").select("id, name"),
    supabase
      .from("sched_week_line")
      .select("id, role_id, department_id")
      .eq("week_id", weekId),
    supabase
      .from("sched_assignment")
      .select("person_id, line_id, removed_post_publish")
      .eq("week_id", weekId)
      .eq("day_of_week", day)
      .eq("location_id", locationId),
    supabase.from("location").select("short_code, name").eq("id", locationId).maybeSingle(),
    supabase.from("sched_department").select("name").eq("id", departmentId).maybeSingle(),
  ]);

  const roleById = new Map(
    ((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [
      r.id,
      r,
    ]),
  );
  const lineById = new Map(
    (
      (lineRes.data ?? []) as {
        id: string;
        role_id: string | null;
        department_id: string | null;
      }[]
    ).map((l) => [l.id, l]),
  );

  // Distinct people per staffing category staffed within this department.
  const staffSets = new Map<string, Set<string>>();
  for (const a of (asgRes.data ?? []) as {
    person_id: string;
    line_id: string;
    removed_post_publish: boolean;
  }[]) {
    if (a.removed_post_publish) continue;
    const line = lineById.get(a.line_id);
    if (!line || line.department_id !== departmentId) continue;
    const role = line.role_id ? roleById.get(line.role_id) : null;
    const cat = classifyRole(role?.name);
    if (!cat) continue;
    let set = staffSets.get(cat);
    if (!set) {
      set = new Set<string>();
      staffSets.set(cat, set);
    }
    set.add(a.person_id);
  }

  const staffing = emptyStaffing();
  for (const [cat, set] of staffSets) {
    staffing[cat as keyof typeof staffing] = set.size;
  }
  const dvmCount = Math.max(1, staffing.dvm);

  const loc = (locRes.data as { short_code: string | null; name: string | null } | null) ?? null;
  const dept = (deptRes.data as { name: string | null } | null) ?? null;
  const locLabel = loc?.short_code || loc?.name || "Location";
  const deptLabel = dept?.name || "Service";

  // Create the guide shell.
  const START = 540; // 9:00
  const END = 1020; // 17:00
  const LUNCH = 720; // 12:00
  const { data: guideRow, error: gErr } = await supabase
    .from("planning_guide")
    .insert({
      name: `${locLabel} — ${deptLabel} ${dvmCount}-DVM`,
      location_id: locationId,
      department_id: departmentId,
      day_model: `${dvmCount}-DVM day (from schedule)`,
      weekdays: [day],
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
    })
    .select("id")
    .single();
  if (gErr) return { ok: false, error: gErr.message };
  const guideId = guideRow.id as string;

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
  const { data: cols, error: cErr } = await supabase
    .from("planning_guide_column")
    .insert(columnRows)
    .select("id, name, sort_order");
  if (cErr) return { ok: false, error: cErr.message };

  // Skeleton slots: 30-minute NAD blocks per exam track, UC blocks in the UC
  // lane, with a lunch break at noon.
  const slotRows: Record<string, unknown>[] = [];
  for (const col of (cols ?? []) as { id: string; name: string }[]) {
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
    await supabase.from("planning_guide_slot").insert(slotRows);
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

interface GenColumn {
  name: string;
  color: string;
  type: string;
}

/**
 * The appointment-track columns to scaffold for a department, derived from the
 * existing planning guides. Exam-style areas get one track per DVM plus a shared
 * Urgent Care lane; specialties get their own single track(s).
 */
function guideColumnsFor(deptName: string, dvmCount: number): GenColumn[] {
  const n = deptName.toLowerCase();
  const dvms = Math.max(1, dvmCount);
  const exam = (label: string, type: string): GenColumn[] =>
    Array.from({ length: dvms }, (_, i) => ({
      name: dvms > 1 ? `DVM ${i + 1} — ${label}` : label,
      color: DVM_COLORS[i % DVM_COLORS.length],
      type,
    }));

  if (n.includes("exotic")) {
    return [{ name: "Exotics", color: "#16a34a", type: "ex_sick" }];
  }
  if (/\bim\b/.test(n) || n.includes("internal")) {
    const cols: GenColumn[] = [
      { name: "Internal Med", color: "#9333ea", type: "im" },
    ];
    if (dvms > 1) {
      cols.push({ name: "Dental Clinic", color: "#db2777", type: "dental" });
    }
    return cols;
  }
  if (n.includes("clinic") || n.includes("wellness") || n.includes("nad")) {
    return [
      ...exam("NAD / Clinic", "nad"),
      { name: "Urgent Care", color: "#d97706", type: "uc" },
    ];
  }
  // AP and any other exam-based area.
  return [
    ...exam("Exam", "nad"),
    { name: "Urgent Care", color: "#d97706", type: "uc" },
  ];
}

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
  const supabase = await createClient();

  const [roleRes, lineRes, asgRes, locRes, deptRes] = await Promise.all([
    supabase.from("sched_role").select("id, name"),
    supabase
      .from("sched_week_line")
      .select("id, role_id, department_id")
      .eq("week_id", weekId),
    supabase
      .from("sched_assignment")
      .select("person_id, line_id, removed_post_publish")
      .eq("week_id", weekId)
      .eq("day_of_week", day)
      .eq("location_id", locationId),
    supabase
      .from("location")
      .select("short_code, name")
      .eq("id", locationId)
      .maybeSingle(),
    supabase
      .from("sched_department")
      .select("name")
      .eq("id", departmentId)
      .maybeSingle(),
  ]);

  const roleById = new Map(
    ((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [
      r.id,
      r,
    ]),
  );
  const lineById = new Map(
    (
      (lineRes.data ?? []) as {
        id: string;
        role_id: string | null;
        department_id: string | null;
      }[]
    ).map((l) => [l.id, l]),
  );

  // Distinct people per staffing category staffed within this department.
  const staffSets = new Map<string, Set<string>>();
  for (const a of (asgRes.data ?? []) as {
    person_id: string;
    line_id: string;
    removed_post_publish: boolean;
  }[]) {
    if (a.removed_post_publish) continue;
    const line = lineById.get(a.line_id);
    if (!line || line.department_id !== departmentId) continue;
    const role = line.role_id ? roleById.get(line.role_id) : null;
    const cat = classifyRole(role?.name);
    if (!cat) continue;
    let set = staffSets.get(cat);
    if (!set) {
      set = new Set<string>();
      staffSets.set(cat, set);
    }
    set.add(a.person_id);
  }

  const staffing = emptyStaffing();
  for (const [cat, set] of staffSets) {
    staffing[cat as keyof typeof staffing] = set.size;
  }
  const dvmCount = Math.max(1, staffing.dvm);

  const loc =
    (locRes.data as { short_code: string | null; name: string | null } | null) ??
    null;
  const dept = (deptRes.data as { name: string | null } | null) ?? null;
  const locLabel = loc?.short_code || loc?.name || "Location";
  const deptLabel = dept?.name || "Service";

  const target = Number.isFinite(targetAppointments)
    ? Math.max(0, Math.trunc(targetAppointments))
    : 0;

  // Remove any prior auto-generated guide for this exact week/loc/dept/day so a
  // regenerate replaces it (cascade drops its columns + slots).
  const { data: prior } = await supabase
    .from("planning_guide")
    .select("id, weekdays")
    .eq("source_week_id", weekId)
    .eq("location_id", locationId)
    .eq("department_id", departmentId)
    .eq("auto_generated", true);
  const priorIds = ((prior ?? []) as { id: string; weekdays: number[] }[])
    .filter((p) => (p.weekdays ?? []).includes(day))
    .map((p) => p.id);
  if (priorIds.length) {
    await supabase.from("planning_guide").delete().in("id", priorIds);
  }

  const START = 540; // 9:00
  const END = 1020; // 17:00
  const LUNCH = 720; // 12:00
  const STEP = 30;
  const times: number[] = [];
  for (let t = START; t < END; t += STEP) times.push(t);

  const genCols = guideColumnsFor(deptLabel, dvmCount);

  // Bookable candidate cells, earliest time first then across columns. Fill the
  // first `target` (all when target is 0) so bookable count == the tile number.
  const candidates: { colIdx: number; t: number }[] = [];
  for (const t of times) {
    if (t === LUNCH) continue;
    for (let c = 0; c < genCols.length; c++) candidates.push({ colIdx: c, t });
  }
  const fillCount =
    target > 0 ? Math.min(target, candidates.length) : candidates.length;
  const bookableCells = new Set<string>();
  for (let i = 0; i < fillCount; i++) {
    bookableCells.add(`${candidates[i].colIdx}|${candidates[i].t}`);
  }

  const { data: guideRow, error: gErr } = await supabase
    .from("planning_guide")
    .insert({
      name: `${locLabel} — ${deptLabel} · ${fillCount} appt`,
      location_id: locationId,
      department_id: departmentId,
      day_model: `${dvmCount}-DVM day · ${fillCount} appts (from capacity)`,
      weekdays: [day],
      dvm_count: dvmCount,
      tech_count: staffing.tech || null,
      lead_count: staffing.lead || null,
      dental_count: staffing.dental || null,
      da_count: staffing.da || null,
      float_count: staffing.float || null,
      start_minute: START,
      end_minute: END,
      slot_minutes: STEP,
      source_week_id: weekId,
      auto_generated: true,
      target_appointments: target > 0 ? target : null,
      notes:
        "Auto-generated from the Daily Capacity tile for this week. The bookable slots match the tile's appointment number — edit the grid to shape the day.",
      created_by: gate.current.authId,
    })
    .select("id")
    .single();
  if (gErr) return { ok: false, error: gErr.message };
  const guideId = guideRow.id as string;

  const { data: cols, error: cErr } = await supabase
    .from("planning_guide_column")
    .insert(
      genCols.map((c, i) => ({
        guide_id: guideId,
        name: c.name,
        color: c.color,
        capacity_note: null as string | null,
        sort_order: i * 10,
      })),
    )
    .select("id, sort_order");
  if (cErr) return { ok: false, error: cErr.message };

  const orderedCols = ((cols ?? []) as { id: string; sort_order: number }[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const slotRows: Record<string, unknown>[] = [];
  orderedCols.forEach((col, colIdx) => {
    const type = genCols[colIdx]?.type ?? "nad";
    for (const t of times) {
      const isLunch = t === LUNCH;
      const isBookable = bookableCells.has(`${colIdx}|${t}`);
      slotRows.push({
        guide_id: guideId,
        column_id: col.id,
        start_minute: t,
        duration_minutes: STEP,
        type_code: isLunch ? "lunch" : isBookable ? type : "open",
        label: isLunch ? "Lunch" : null,
        sort_order: 0,
      });
    }
  });
  if (slotRows.length) {
    await supabase.from("planning_guide_slot").insert(slotRows);
  }

  revalidatePath("/planning");
  revalidatePath("/capacity");
  revalidatePath("/schedule");
  return { ok: true, data: { id: guideId } };
}

