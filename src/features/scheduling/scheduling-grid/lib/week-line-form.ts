import type { SchedWeekLine } from "@/lib/schedule/types";
import {
  NEW_ROLE_OPTION,
  type WeekLineFormValues,
  type WeekLineSubmitValues,
} from "@/features/scheduling/scheduling-grid/schema/week-line.schema";

/** The Line dialog's starting values: the line being edited, or a blank line in `defaultDeptId`. */
export function weekLineFormDefaults(
  line: SchedWeekLine | null,
  defaultDeptId?: string,
): WeekLineFormValues {
  return {
    department_id: line?.department_id ?? defaultDeptId ?? "",
    role_id: line?.role_id ?? "",
    new_role_name: "",
    label: line?.label ?? "",
    start_time: line?.start_time ?? "",
    end_time: line?.end_time ?? "",
    sort_order: String(line?.sort_order ?? 9999),
  };
}

/**
 * Resolve the role select for the action: "+ New role…" sends no role id and
 * keeps the typed name (the action finds-or-creates the role); any other
 * choice sends the id and drops a stray name.
 */
export function toWeekLineInput(values: WeekLineFormValues): WeekLineSubmitValues {
  if (values.role_id === NEW_ROLE_OPTION) {
    return { ...values, role_id: "" };
  }
  return { ...values, new_role_name: "" };
}
