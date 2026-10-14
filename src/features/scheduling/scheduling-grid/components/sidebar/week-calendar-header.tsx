"use client";

import { addMonths } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/features/scheduling/scheduling-grid/lib/week-calendar";

/** "October 2026 · Today · ‹ ›" — the calendar's own caption and nav are hidden in favour of this row. */
export function WeekCalendarHeader({
  month,
  onMonthChange,
  onToday,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-base font-bold tracking-tight text-slate-900">{monthLabel(month)}</h3>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => onMonthChange(addMonths(month, -1))}>
          <ChevronLeftIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
