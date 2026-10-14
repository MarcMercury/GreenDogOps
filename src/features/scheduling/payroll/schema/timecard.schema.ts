import { requiredDate, requiredUuid, z } from "@/lib/validation/form";

/**
 * Arguments of approve / un-approve: which employee, in which pay period.
 * `personId` is listed first so a call with both arguments malformed is
 * reported as an unknown employee, the order the checks ran in before the
 * schema existed. Whether the period exists, is open, or belongs to the caller
 * stays with the action.
 */
export const timecardSchema = z.object({
  personId: requiredUuid("employee"),
  periodStart: requiredDate("Pay period"),
});

export type TimecardInput = z.infer<typeof timecardSchema>;
