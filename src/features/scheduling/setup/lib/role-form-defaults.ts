import type { RoleFormValues } from "@/features/scheduling/setup/schema/role.schema";

/** Initial values of the Add-role form: no department chosen, order 0. */
export function roleFormDefaults(): RoleFormValues {
  return { department_id: "", name: "", sort_order: "0" };
}
