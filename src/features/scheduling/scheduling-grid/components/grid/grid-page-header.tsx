"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { formatWeekRange, type SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WeekStatusBadge } from "@/features/scheduling/scheduling-grid/components/grid/week-status-badge";

/** ‹ › around the open week's dates, with its workflow status. */
export function GridPageHeader({
  week,
  prev,
  next,
}: {
  week: SchedWeek;
  prev: SchedWeek | null;
  next: SchedWeek | null;
}) {
  const router = useRouter();
  const go = (w: SchedWeek | null) => w && router.push(`/schedule?week=${w.id}`);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" size="icon" disabled={!prev} onClick={() => go(prev)} aria-label="Previous week" />
            }
          >
            <ChevronLeftIcon />
          </TooltipTrigger>
          <TooltipContent>{prev ? `Previous week — ${formatWeekRange(prev.week_start)}` : "No earlier week"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" size="icon" disabled={!next} onClick={() => go(next)} aria-label="Next week" />
            }
          >
            <ChevronRightIcon />
          </TooltipTrigger>
          <TooltipContent>{next ? `Next week — ${formatWeekRange(next.week_start)}` : "No later week"}</TooltipContent>
        </Tooltip>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{formatWeekRange(week.week_start)}</h1>
      <WeekStatusBadge status={week.status} />
    </div>
  );
}
