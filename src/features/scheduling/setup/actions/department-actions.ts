"use server";

import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  deleteDepartmentSchema,
  departmentSchema,
  type DepartmentFormValues,
} from "@/features/scheduling/setup/schema/department.schema";
import { upsertDepartment } from "@/features/scheduling/setup/db/upsert-department";
import { deleteDepartmentRow } from "@/features/scheduling/setup/db/delete-department-row";

// ===========================================================================
// SETUP — departments (also edited straight from the grid's department modal)
// ===========================================================================

/**
 * Create or update a department from the form's values. The browser already
 * ran `departmentSchema`; it runs again here because the browser is untrusted.
 */
export async function saveDepartment(input: DepartmentFormValues): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(departmentSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...patch } = parsed.data;

  const { error } = await upsertDepartment(id, patch);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(deleteDepartmentSchema, { id });
  if (!parsed.ok) return parsed;

  const { error } = await deleteDepartmentRow(parsed.data.id);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}
