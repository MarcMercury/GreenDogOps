"use client";

import { cn } from "cn";
import { SCHEDULE_STATUS_LABELS, type ScheduleStatus } from "@/lib/schedule/types";
import { Badge } from "@/components/ui/badge";
import { WEEK_STATUS_BADGE } from "@/features/scheduling/scheduling-grid/lib/week-status-style";

/** The week's workflow status as a coloured pill ("Draft", "Published", …). */
export function WeekStatusBadge({ status, className }: { status: ScheduleStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-full px-2.5 py-0.5 font-semibold", WEEK_STATUS_BADGE[status], className)}>
      {SCHEDULE_STATUS_LABELS[status]}
    </Badge>
  );
}
