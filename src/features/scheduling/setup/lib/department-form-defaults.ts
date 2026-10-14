import type { SchedDepartment } from "@/lib/schedule/types";
import type { DepartmentFormValues } from "@/features/scheduling/setup/schema/department.schema";

/**
 * Initial values of the department form: a blank, active department for
 * "New", or the department being edited. Numbers become strings because that
 * is what the inputs hold; the schema turns them back.
 */
export function departmentFormDefaults(dept?: SchedDepartment | null): DepartmentFormValues {
  return {
    id: dept?.id ?? null,
    name: dept?.name ?? "",
    code: dept?.code ?? "",
    color: dept?.color ?? "#64748b",
    sort_order: String(dept?.sort_order ?? 0),
    is_active: dept?.is_active ?? true,
    show_in_planning: dept?.show_in_planning ?? false,
  };
}
