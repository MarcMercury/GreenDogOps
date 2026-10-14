"use server";

import { revalidatePath } from "next/cache";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseForm, parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { deleteRoleSchema, roleSchema } from "@/features/scheduling/setup/schema/role.schema";
import {
  setPersonRolesSchema,
  setRoleMembersSchema,
  toggleRoleMemberSchema,
} from "@/features/scheduling/setup/schema/role-member.schema";
import { studentRoleFlagsSchema } from "@/features/scheduling/setup/schema/student-flags.schema";
import { upsertRole } from "@/features/scheduling/setup/db/upsert-role";
import { deleteRoleRow } from "@/features/scheduling/setup/db/delete-role-row";
import { addRoleMember } from "@/features/scheduling/setup/db/add-role-member";
import { removeRoleMember } from "@/features/scheduling/setup/db/remove-role-member";
import { replaceRoleMembers } from "@/features/scheduling/setup/db/replace-role-members";
import { replacePersonRoles } from "@/features/scheduling/setup/db/replace-person-roles";
import { upsertStudentFlags } from "@/features/scheduling/setup/db/upsert-student-flags";

// ===========================================================================
// SETUP — roles and who is eligible for them
// ===========================================================================

export async function saveRole(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return parsed;
  const { id, ...patch } = parsed.data;

  const { error } = await upsertRole(id, patch);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(deleteRoleSchema, { id });
  if (!parsed.ok) return parsed;

  const { error } = await deleteRoleRow(parsed.data.id);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
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

  const parsed = parseInput(toggleRoleMemberSchema, { roleId, personId, eligible });
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const { error } = v.eligible
    ? await addRoleMember(v.roleId, v.personId)
    : await removeRoleMember(v.roleId, v.personId);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
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

  const parsed = parseInput(setRoleMembersSchema, { roleId, personIds });
  if (!parsed.ok) return parsed;

  const { error } = await replaceRoleMembers(parsed.data.roleId, parsed.data.personIds);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
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

  const parsed = parseInput(setPersonRolesSchema, { personId, roleIds });
  if (!parsed.ok) return parsed;

  const { error } = await replacePersonRoles(parsed.data.personId, parsed.data.roleIds);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
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

  const parsed = parseInput(studentRoleFlagsSchema, { personId, isMentor, isCoordinator });
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const { error } = await upsertStudentFlags(v.personId, v.isMentor, v.isCoordinator);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  revalidatePath("/hr");
  revalidatePath("/crm");
  return { ok: true };
}
