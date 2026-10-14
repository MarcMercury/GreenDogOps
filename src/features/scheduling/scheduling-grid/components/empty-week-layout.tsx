"use client";

import type { SchedWeek } from "@/lib/schedule/types";
import { EmptyWeekState } from "@/features/scheduling/scheduling-grid/components/empty-week-state";
import { SchedulePageShell } from "@/features/scheduling/scheduling-grid/components/schedule-page-shell";
import { WeeksCard } from "@/features/scheduling/scheduling-grid/components/sidebar/weeks-card";

/** The schedule page when no week is open: the Weeks card to pick or create one, and an empty state. */
export function EmptyWeekLayout({ weeks, canEdit }: { weeks: SchedWeek[]; canEdit: boolean }) {
  return (
    <SchedulePageShell
      sidebar={<WeeksCard weeks={weeks} selectedWeekStart={null} selectedId={null} canEdit={canEdit} />}
    >
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Weekly Grid</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build, approve, and publish the visual weekly schedule. Pick a week in the calendar to open it.
        </p>
      </div>
      <EmptyWeekState />
    </SchedulePageShell>
  );
}
