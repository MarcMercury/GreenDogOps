/**
 * A partial change to one employee's row on Set Up ▸ Employees. The tab fills
 * the rest of the row from the person's current setting before saving.
 */
export interface EmployeeSettingUpdate {
  target?: number;
  schedulable?: boolean;
  loc?: string | null;
  eligibleLocs?: string[];
  days?: number[];
}
