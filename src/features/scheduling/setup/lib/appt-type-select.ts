import type { ApptTypeDeptMapping } from "@/lib/schedule/types";
import type { ApptTypeDeptValues } from "@/features/scheduling/setup/schema/appt-type.schema";

/** Option value that marks an appointment type as "Ignore (don't count)". */
export const IGNORE_VALUE = "__ignore";

/** Value of the Department <select> for one appointment type. */
export function apptTypeSelectValue(
  m: Pick<ApptTypeDeptMapping, "is_ignored" | "department_id">,
): string {
  return m.is_ignored ? IGNORE_VALUE : m.department_id ?? "";
}

/**
 * The reverse: what `saveApptTypeDept` receives for a Department <select>
 * choice — the ignore marker becomes the flag with no department, anything
 * else is the department (blank = unassigned).
 */
export function apptTypeDeptInput(apptType: string, selectValue: string): ApptTypeDeptValues {
  return selectValue === IGNORE_VALUE
    ? { appt_type: apptType, department_id: "", is_ignored: true }
    : { appt_type: apptType, department_id: selectValue, is_ignored: false };
}
