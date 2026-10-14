import type { ScheduleLocation, SchedEmployeeSetting } from "@/lib/schedule/types";

/**
 * Default eligibility for employees with no explicit selection: every
 * location except MPMV (i.e. SO, VEN, VAN). Mirrors the schedule grid which
 * also excludes MPMV.
 */
export function defaultEligibleLocationIds(
  locations: Pick<ScheduleLocation, "id" | "name" | "short_code">[],
): string[] {
  return locations
    .filter((l) => (l.short_code ?? l.name).toUpperCase() !== "MPMV")
    .map((l) => l.id);
}

/**
 * The eligible-location chips lit for one employee row: none while the person
 * is not schedulable, their saved list when they have one, else the default.
 */
export function effectiveEligibleLocationIds(
  setting: Pick<SchedEmployeeSetting, "is_schedulable" | "eligible_location_ids"> | undefined,
  defaults: string[],
): string[] {
  const schedulable = setting?.is_schedulable ?? false;
  return !schedulable
    ? []
    : setting?.eligible_location_ids?.length
      ? setting.eligible_location_ids
      : defaults;
}
