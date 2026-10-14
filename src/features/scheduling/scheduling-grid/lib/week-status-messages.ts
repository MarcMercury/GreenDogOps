import type { ScheduleStatus } from "@/lib/schedule/types";

/** The success toast for each workflow transition the grid's buttons make. */
export const WEEK_STATUS_SUCCESS: Record<ScheduleStatus, string> = {
  draft: "Week reopened",
  pending_approval: "Submitted for approval",
  approved: "Week approved",
  published: "Week published",
  archived: "Week archived",
};
