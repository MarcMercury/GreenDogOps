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

/**
 * What the Add-role form holds: no `id` (roles are only created here) and no
 * `is_active` (see above — absent means active). `roleSchema` parses it on the
 * client and again in `saveRole`.
 */
export interface RoleFormValues {
  department_id: string;
  name: string;
  sort_order: string;
}

export const deleteRoleSchema = z.object({
  id: requiredUuid("role id"),
});
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;
