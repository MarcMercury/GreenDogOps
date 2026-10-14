import type { ShiftTemplateFormValues } from "@/features/scheduling/setup/schema/shift-template.schema";

/**
 * The Role select's third kind of value, beside "" (any role) and an existing
 * role id: create a role inline from the "New role name" box.
 */
export const NEW_ROLE_OPTION = "__new__";

/** Whether the form is currently creating a role inline. */
export function isNewRole(values: Pick<ShiftTemplateFormValues, "role_id">): boolean {
  return values.role_id === NEW_ROLE_OPTION;
}

/**
 * Turn the form's values into what `saveShiftTemplate` accepts: "+ New role…"
 * becomes an empty `role_id` with the typed name, and any other choice drops
 * the typed name so a stale entry is never sent. `resolveRoleId` then finds or
 * creates the role by name within the department.
 */
export function toShiftTemplateInput(values: ShiftTemplateFormValues): ShiftTemplateFormValues {
  if (isNewRole(values)) return { ...values, role_id: "" };
  return { ...values, new_role_name: "" };
}
