import type { ScheduleStatus } from "@/lib/schedule/types";

/**
 * The week workflow's colours on the schedule page (mock "Weekly schedule"):
 * draft amber, pending blue, approved sky, published green. A week that does
 * not exist yet is a hollow dot.
 */
export const WEEK_STATUS_DOT: Record<ScheduleStatus, string> = {
  draft: "bg-amber-400",
  pending_approval: "bg-blue-500",
  approved: "bg-sky-500",
  published: "bg-emerald-500",
  archived: "bg-slate-300",
};

export const NOT_CREATED_DOT = "border border-slate-300 bg-transparent";

export const WEEK_STATUS_BADGE: Record<ScheduleStatus, string> = {
  draft: "bg-amber-100 text-amber-800",
  pending_approval: "bg-blue-100 text-blue-800",
  approved: "bg-sky-100 text-sky-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-slate-100 text-slate-600",
};

/** Legend order under the calendar. */
export const WEEK_STATUS_LEGEND: ScheduleStatus[] = ["published", "approved", "pending_approval", "draft"];
