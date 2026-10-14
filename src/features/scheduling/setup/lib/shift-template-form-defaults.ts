import type { SchedShiftTemplate } from "@/lib/schedule/types";
import type { ShiftTemplateFormValues } from "@/features/scheduling/setup/schema/shift-template.schema";

/**
 * Initial values of the template-line form: blank for "New", or the line being
 * edited. The role select shows the saved role id ("" = any); the new-role box
 * always starts empty.
 */
export function shiftTemplateFormDefaults(t?: SchedShiftTemplate | null): ShiftTemplateFormValues {
  return {
    id: t?.id ?? null,
    department_id: t?.department_id ?? "",
    role_id: t?.role_id ?? "",
    new_role_name: "",
    label: t?.label ?? "",
    start_time: t?.start_time ?? "",
    end_time: t?.end_time ?? "",
    sort_order: String(t?.sort_order ?? 0),
  };
}
