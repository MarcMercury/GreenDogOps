"use client";

import { useMemo } from "react";
import { formatWeekRange, type SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WeekStatusBadge } from "@/features/scheduling/scheduling-grid/components/grid/week-status-badge";
import { WeekStatusDot } from "@/features/scheduling/scheduling-grid/components/sidebar/week-status-dot";

/** Every schedule week, newest first, to jump somewhere the calendar rail doesn't reach. */
export function AllWeeksDialog({
  open,
  onOpenChange,
  weeks,
  selectedId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weeks: SchedWeek[];
  selectedId: string | null;
  onPick: (weekId: string) => void;
}) {
  const newestFirst = useMemo(
    () => [...weeks].sort((a, b) => b.week_start.localeCompare(a.week_start)),
    [weeks],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>All weeks</DialogTitle>
          <DialogDescription>{weeks.length} weeks, newest first.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 max-h-[60vh] overflow-y-auto">
          {newestFirst.map((w) => (
            <li key={w.id}>
              <Button
                variant="ghost"
                aria-current={w.id === selectedId ? "page" : undefined}
                onClick={() => onPick(w.id)}
                className={`h-auto w-full justify-between px-2 py-1.5 font-normal ${
                  w.id === selectedId ? "bg-slate-100" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <WeekStatusDot status={w.status} />
                  {formatWeekRange(w.week_start)}
                </span>
                <WeekStatusBadge status={w.status} className="text-[10px]" />
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
