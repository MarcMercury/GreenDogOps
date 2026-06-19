"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import type { AttendanceStatus, ScheduleStatus } from "@/lib/schedule/types";
import { dateForDay } from "@/lib/schedule/types";
import { DEFAULT_WEEK_TEMPLATE } from "@/lib/schedule/default-template";

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
}

// ===========================================================================
// SETUP — departments
// ===========================================================================

export async function saveDepartment(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")),
    code: str(formData.get("code")),
    color: str(formData.get("color")) ?? "#64748b",
    sort_order: int(formData.get("sort_order")),
    is_active: formData.has("is_active") ? bool(formData.get("is_active")) : true,
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
  const supabase = await createClient();
  const { error } = await supabase.from("sched_role").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Replace the full member list of a role with the given person ids. */
export async function setRoleMembers(
  roleId: string,
  personIds: string[],
): Promise<ActionResult> {
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

// ===========================================================================
// SETUP — shift templates
// ===========================================================================

export async function saveShiftTemplate(
  formData: FormData,
): Promise<ActionResult> {
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
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("sched_employee_setting").upsert(
    {
      person_id: personId,
      weekly_shift_target: weeklyTarget,
      is_schedulable: isSchedulable,
      default_location_id: defaultLocationId,
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
    .select("id, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  const weekLocs = (locs ?? []).map((l: Record<string, unknown>) => ({
    week_id: weekId,
    location_id: l.id,
    sort_order: (l.sort_order as number) ?? 0,
  }));
  if (weekLocs.length > 0)
    await supabase.from("sched_week_location").insert(weekLocs);

  revalidateAll();
  return { ok: true, data: weekId };
}

export async function setWeekLocations(
  weekId: string,
  locationIds: string[],
): Promise<ActionResult> {
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

/** Mark attendance for an assignment (post-publish). */
export async function markAttendance(
  assignmentId: string,
  status: AttendanceStatus,
  note: string | null,
): Promise<ActionResult> {
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
  const supabase = await createClient();
  const { error } = await supabase.from("sched_week").delete().eq("id", weekId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
