import { SCHEDULE_STATUS_LABELS, type ScheduleStatus } from "@/lib/schedule/types";
import { requiredUuid, z } from "@/lib/validation/form";

/** Every workflow status, taken from the authoritative label map. */
const SCHEDULE_STATUSES = Object.keys(SCHEDULE_STATUS_LABELS) as [
  ScheduleStatus,
  ...ScheduleStatus[],
];

/**
 * setWeekStatus: a workflow transition (draft → pending approval → approved →
 * published). `confirmUntimed` is the "Publish anyway?" override for shifts
 * with no start/end time.
 */
export const setWeekStatusSchema = z.object({
  weekId: requiredUuid("week id"),
  status: z.enum(SCHEDULE_STATUSES),
  confirmUntimed: z.boolean().optional(),
});
export type SetWeekStatusInput = z.infer<typeof setWeekStatusSchema>;
