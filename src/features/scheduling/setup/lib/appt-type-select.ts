import type { ApptTypeDeptMapping } from "@/lib/schedule/types";

/** Option value that marks an appointment type as "Ignore (don't count)". */
export const IGNORE_VALUE = "__ignore";

/** Value of the Department <select> for one appointment type. */
export function apptTypeSelectValue(
  m: Pick<ApptTypeDeptMapping, "is_ignored" | "department_id">,
): string {
  return m.is_ignored ? IGNORE_VALUE : m.department_id ?? "";
}
