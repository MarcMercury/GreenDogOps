"use client";

import type { SchedWeek } from "@/lib/schedule/types";
import { publishUrgency } from "@/lib/schedule/publish";
import { todayInWorkTz } from "@/lib/worklist/dates";

/**
 * Go-live item 9: the current week (and next week from Thursday) must be
 * published — My Time shows published weeks only, and clock-ins are matched to
 * published shifts.
 */
export function UnpublishedBanner({ weekStart, status }: { weekStart: string; status: SchedWeek["status"] }) {
  const urgency = publishUrgency(weekStart, status, todayInWorkTz());
  if (!urgency) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
      <span className="font-semibold">
        {urgency === "overdue" ? "This week is not published." : "Next week should be published by Thursday."}
      </span>{" "}
      Staff can&apos;t see unpublished shifts in My Time, and their punches can&apos;t be matched to a shift. Submit,
      approve and publish it.
    </div>
  );
}
