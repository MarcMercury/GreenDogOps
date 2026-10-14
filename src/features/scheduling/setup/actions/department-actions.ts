"use server";

import { ensureCanEdit } from "@/lib/auth/session";
import { parseForm, parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  deleteDepartmentSchema,
  departmentSchema,
} from "@/features/scheduling/setup/schema/department.schema";
import { upsertDepartment } from "@/features/scheduling/setup/db/upsert-department";
import { deleteDepartmentRow } from "@/features/scheduling/setup/db/delete-department-row";

// ===========================================================================
// SETUP — departments (also edited straight from the grid's department modal)
// ===========================================================================

export async function saveDepartment(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseForm(departmentSchema, formData);
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
