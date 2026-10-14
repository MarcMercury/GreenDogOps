import type { AddPunchFormValues } from "@/features/scheduling/time-clock/schema/add-punch.schema";

/**
 * The initial values of the "Add the missing punch" form for one queue row:
 * the employee and day are fixed, the punch type is pre-selected from what is
 * missing (no clock-out → clock out), and the rest starts blank.
 */
export function addPunchFormDefaults(
  personId: string,
  workDate: string,
  defaultType: "clock_in" | "clock_out",
): AddPunchFormValues {
  return {
    person_id: personId,
    work_date: workDate,
    punch_type: defaultType,
    time: "",
    next_day: false,
    reason: "",
  };
}
