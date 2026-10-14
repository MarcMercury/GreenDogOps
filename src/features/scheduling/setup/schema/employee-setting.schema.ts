import { optionalUuid, requiredUuid, z } from "@/lib/validation/form";

/** Shifts per week. The input is min 0 / max 7 but any whole number can be typed. */
const weeklyTarget = z.number().int().min(0).max(99);
/** Weekday numbers 0=Sun..6=Sat; empty = any day. */
const availableDays = z.array(z.number().int().min(0).max(6));

/** The full `sched_employee_setting` row as Set Up ▸ Employees saves it. */
export const employeeSettingSchema = z.object({
  personId: requiredUuid("person id"),
  weeklyTarget,
  isSchedulable: z.boolean(),
  defaultLocationId: optionalUuid,
  /** Empty = any location. */
  eligibleLocationIds: z.array(requiredUuid("location id")),
  availableDays,
});
export type EmployeeSettingInput = z.infer<typeof employeeSettingSchema>;

/**
 * Partial update from the HR profile's Scheduling settings panel: only the
 * fields given are changed, the rest of the row is preserved.
 */
export const scheduleSettingFieldsSchema = z.object({
  personId: requiredUuid("person id"),
  fields: z
    .object({
      isSchedulable: z.boolean(),
      weeklyTarget,
      availableDays,
    })
    .partial(),
});
export type ScheduleSettingFieldsInput = z.infer<typeof scheduleSettingFieldsSchema>;
