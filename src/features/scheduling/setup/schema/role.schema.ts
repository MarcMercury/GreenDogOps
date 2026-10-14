import {
  checkboxDefaultOn,
  intInRange,
  optionalUuid,
  requiredText,
  requiredUuid,
  z,
} from "@/lib/validation/form";

/**
 * The Add-role form on Set Up ▸ Roles & Eligibility. It has no "Active" box,
 * so a missing `is_active` must mean active — with the plain `checkbox` helper
 * (de633bb → 2026-10-13) every role added there was inserted inactive and then
 * hidden from the HR profile's eligibility list, which only shows active roles.
 */
export const roleSchema = z.object({
  id: optionalUuid,
  department_id: requiredUuid("department"),
  name: requiredText(120, "Role name"),
  sort_order: intInRange(0, 9999, 0),
  is_active: checkboxDefaultOn,
});
export type RoleInput = z.infer<typeof roleSchema>;

export const deleteRoleSchema = z.object({
  id: requiredUuid("role id"),
});
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;
