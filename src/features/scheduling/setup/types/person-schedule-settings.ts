/**
 * Read-only snapshot of a single employee's scheduling configuration, resolved
 * into display-ready labels for the HR profile. The source of truth stays in
 * Schedule → Setup → Employees; this just surfaces it so the same employee data
 * is visible everywhere it's referenced.
 */
export interface PersonScheduleSettings {
  hasSetting: boolean;
  isSchedulable: boolean;
  weeklyTarget: number | null;
  defaultLocationName: string | null;
  /** Empty list means "any location" (no explicit restriction). */
  eligibleLocationNames: string[];
  /** Weekday numbers 0=Sun..6=Sat. Empty means "any day". */
  availableDays: number[];
  roleNames: string[];
  notes: string | null;
}
