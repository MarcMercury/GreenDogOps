"use client";

import { InfoIcon } from "lucide-react";
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
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
      <p>
        <span className="font-semibold text-red-900">
          {urgency === "overdue" ? "This week isn’t published." : "Next week should be published by Thursday."}
        </span>{" "}
        Staff can’t see unpublished shifts in My Time, and their punches can’t be matched to a shift. Submit,
        approve and publish it.
      </p>
    </div>
  );
}
