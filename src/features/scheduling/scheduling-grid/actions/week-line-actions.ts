"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseForm, parseInput } from "@/lib/validation/form";
import { DEFAULT_WEEK_TEMPLATE } from "@/lib/schedule/default-template";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { resolveRoleId } from "@/features/scheduling/setup/db/resolve-role-id";
import {
  addWeekLineSchema,
  removeWeekLineSchema,
  updateWeekLineSchema,
  weekLinesForWeekSchema,
} from "@/features/scheduling/scheduling-grid/schema/week-line.schema";
import { countShiftTemplates } from "@/features/scheduling/scheduling-grid/db/count-shift-templates";
import { deleteWeekLine } from "@/features/scheduling/scheduling-grid/db/delete-week-line";
import { getActiveShiftTemplates } from "@/features/scheduling/scheduling-grid/db/get-active-shift-templates";
import { getDepartmentNames } from "@/features/scheduling/scheduling-grid/db/get-department-names";
import { getRolesForDepartments } from "@/features/scheduling/scheduling-grid/db/get-roles-for-departments";
import { getWeekLineTemplateIds } from "@/features/scheduling/scheduling-grid/db/get-week-line-template-ids";
import { insertDepartments } from "@/features/scheduling/scheduling-grid/db/insert-departments";
import { insertRoles } from "@/features/scheduling/scheduling-grid/db/insert-roles";
import { insertShiftTemplates } from "@/features/scheduling/scheduling-grid/db/insert-shift-templates";
import { insertWeekLine } from "@/features/scheduling/scheduling-grid/db/insert-week-line";
import { insertWeekLines } from "@/features/scheduling/scheduling-grid/db/insert-week-lines";
import { updateWeekLineRow } from "@/features/scheduling/scheduling-grid/db/update-week-line-row";

/** Add an ad-hoc shift line to a week (not derived from a template). */
export async function addWeekLine(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseForm(addWeekLineSchema, formData);
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const supabase = await createClient();
  // Every shift type is identified by its role name: a typed "+ New role…" name
  // (or an existing role) resolves to a single `sched_role`, which drives the
  // eligibility checkbox in Setup and on the HR profile. "— any —" stays null.
  const role = await resolveRoleId(supabase, v.department_id, v.role_id, v.new_role_name);
  if ("error" in role) return { ok: false, error: role.error };

  const { error } = await insertWeekLine(supabase, {
    week_id: v.week_id,
    department_id: v.department_id,
    role_id: role.id,
    label: v.label,
    start_time: v.start_time,
    end_time: v.end_time,
    sort_order: v.sort_order,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}

/** Edit an existing shift line on a week's grid. */
export async function updateWeekLine(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseForm(updateWeekLineSchema, formData);
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const supabase = await createClient();
  const role = await resolveRoleId(supabase, v.department_id, v.role_id, v.new_role_name);
  if ("error" in role) return { ok: false, error: role.error };

  const { error } = await updateWeekLineRow(supabase, v.id, {
    department_id: v.department_id,
    role_id: role.id,
    label: v.label,
    start_time: v.start_time,
    end_time: v.end_time,
    sort_order: v.sort_order,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}

/** Delete a shift line from a week's grid (its assignments go with it). */
export async function removeWeekLine(lineId: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(removeWeekLineSchema, { lineId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await deleteWeekLine(supabase, parsed.data.lineId);
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
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
  const parsed = parseInput(weekLinesForWeekSchema, { weekId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const [lines, templates] = await Promise.all([
    getWeekLineTemplateIds(supabase, parsed.data.weekId),
    getActiveShiftTemplates(supabase),
  ]);
  const have = new Set(
    lines.map((l) => l.template_id).filter(Boolean) as string[],
  );
  const toAdd = templates
    .filter((t) => !have.has(t.id))
    .map((t) => ({
      week_id: parsed.data.weekId,
      template_id: t.id,
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: t.sort_order ?? 0,
    }));
  if (toAdd.length > 0) {
    const { error } = await insertWeekLines(supabase, toAdd);
    if (error) return { ok: false, error: error.message };
  }
  revalidateSchedulePaths();
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
  const parsed = parseInput(weekLinesForWeekSchema, { weekId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();

  // 1. Ensure every template department exists.
  const existingDepts = await getDepartmentNames(supabase);
  const deptByName = new Map(
    existingDepts.map((d) => [d.name.toLowerCase(), d.id]),
  );
  const deptInserts = DEFAULT_WEEK_TEMPLATE.filter(
    (d) => !deptByName.has(d.name.toLowerCase()),
  ).map((d, i) => ({
    name: d.name,
    color: d.color,
    sort_order: (DEFAULT_WEEK_TEMPLATE.indexOf(d) + 1) * 10 + i,
  }));
  if (deptInserts.length > 0) {
    const { data: created, error } = await insertDepartments(supabase, deptInserts);
    if (error) return { ok: false, error: error.message };
    for (const d of created) deptByName.set(d.name.toLowerCase(), d.id);
  }

  // Only seed roles + shift templates the first time (no templates yet).
  const alreadySeeded = (await countShiftTemplates(supabase)) > 0;

  if (!alreadySeeded) {
    const deptIds = DEFAULT_WEEK_TEMPLATE.map((d) =>
      deptByName.get(d.name.toLowerCase()),
    ).filter(Boolean) as string[];

    // 2. Ensure one role per (department, role name).
    const existingRoles = await getRolesForDepartments(supabase, deptIds);
    const roleKey = (deptId: string, name: string) =>
      `${deptId}|${name.toLowerCase()}`;
    const roleMap = new Map(
      existingRoles.map((r) => [roleKey(r.department_id, r.name), r.id]),
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
      const { data: createdRoles, error } = await insertRoles(supabase, roleInserts);
      if (error) return { ok: false, error: error.message };
      for (const r of createdRoles)
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
      const { error } = await insertShiftTemplates(supabase, tplInserts);
      if (error) return { ok: false, error: error.message };
    }
  }

  // 4. Copy the active templates into this week.
  return syncWeekLinesFromTemplates(parsed.data.weekId);
}
