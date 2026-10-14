"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  deleteShiftTemplateSchema,
  shiftTemplateSchema,
  type ShiftTemplateFormValues,
} from "@/features/scheduling/setup/schema/shift-template.schema";
import { resolveRoleId } from "@/features/scheduling/setup/db/resolve-role-id";
import { upsertShiftTemplate } from "@/features/scheduling/setup/db/upsert-shift-template";
import { deleteShiftTemplateRow } from "@/features/scheduling/setup/db/delete-shift-template-row";

// ===========================================================================
// SETUP — Dept/Shift Template (the canonical shift lines)
// ===========================================================================

/**
 * Create or update a template line from the form's (already mapped) values —
 * `role_id` is an existing role id or blank, never the "+ New role…" marker.
 * The browser already ran `shiftTemplateFormSchema`; the base schema runs
 * again here because the browser is untrusted.
 */
export async function saveShiftTemplate(
  input: ShiftTemplateFormValues,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(shiftTemplateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  // Every shift type is identified by its role name, so a template line with a
  // typed "+ New role…" name (or an existing role) always resolves to a single
  // `sched_role`. That role is what drives the eligibility checkbox shown in
  // Schedule → Setup → Roles & Eligibility and the HR profile — one checkbox per
  // role name regardless of how many time slots reuse it. "— any —" stays null.
  const supabase = await createClient();
  const role = await resolveRoleId(supabase, v.department_id, v.role_id, v.new_role_name);
  if ("error" in role) return { ok: false, error: role.error };

  const { error } = await upsertShiftTemplate(v.id, {
    department_id: v.department_id,
    role_id: role.id,
    label: v.label,
    start_time: v.start_time,
    end_time: v.end_time,
    sort_order: v.sort_order,
    is_active: v.is_active,
  });
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}

export async function deleteShiftTemplate(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(deleteShiftTemplateSchema, { id });
  if (!parsed.ok) return parsed;

  const { error } = await deleteShiftTemplateRow(parsed.data.id);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}
