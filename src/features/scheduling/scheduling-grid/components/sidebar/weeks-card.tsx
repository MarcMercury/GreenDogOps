"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeekRange, weekStartFor, type SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/features/scheduling/shared/components/confirm-dialog";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import { toastError } from "@/features/scheduling/shared/lib/action-toast";
import { createWeek } from "@/features/scheduling/scheduling-grid/actions/week-actions";
import { AllWeeksDialog } from "@/features/scheduling/scheduling-grid/components/sidebar/all-weeks-dialog";
import { WeekCalendar } from "@/features/scheduling/scheduling-grid/components/sidebar/week-calendar";
import { WeekCalendarHeader } from "@/features/scheduling/scheduling-grid/components/sidebar/week-calendar-header";
import { WeekStatusLegend } from "@/features/scheduling/scheduling-grid/components/sidebar/week-status-legend";
import {
  calendarMonthFor,
  weekIdByStart,
  weekStatusByStart,
} from "@/features/scheduling/scheduling-grid/lib/week-calendar";

/**
 * The "Weeks" card: a month calendar whose rows are schedule weeks (status
 * dot per week, the open week as a navy pill). Clicking a created week opens
 * it; clicking a week that does not exist yet offers to create it. "All
 * weeks" lists every week for a long jump. The month shown starts at the open
 * week — render it with `key={selectedWeekStart}` so it follows ‹ ›.
 */
export function WeeksCard({
  weeks,
  selectedWeekStart,
  selectedId,
  canEdit,
}: {
  /** Schedule weeks only (no templates). */
  weeks: SchedWeek[];
  selectedWeekStart: string | null;
  selectedId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { run } = useAction();
  const statusByStart = useMemo(() => weekStatusByStart(weeks), [weeks]);
  const idByStart = useMemo(() => weekIdByStart(weeks), [weeks]);
  const [month, setMonth] = useState(() => calendarMonthFor(selectedWeekStart ?? weekStartFor(new Date())));
  const [allOpen, setAllOpen] = useState(false);
  const [createFor, setCreateFor] = useState<string | null>(null);

  const open = (weekId: string) => router.push(`/schedule?week=${weekId}`);

  const pickWeek = (weekStart: string) => {
    const id = idByStart.get(weekStart);
    if (id) {
      open(id);
      return;
    }
    if (!canEdit) {
      toastError(`The week of ${formatWeekRange(weekStart)} hasn't been created yet.`);
      return;
    }
    setCreateFor(weekStart);
  };

  const goToday = () => {
    const ws = weekStartFor(new Date());
    setMonth(calendarMonthFor(ws));
    const id = idByStart.get(ws);
    if (id) open(id);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardDescription className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Staff schedule
          </CardDescription>
          <CardTitle className="text-xl font-bold tracking-tight">Weeks</CardTitle>
          <CardAction>
            <Button variant="link" size="sm" className="text-slate-700" onClick={() => setAllOpen(true)}>
              All weeks ({weeks.length})
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <WeekCalendarHeader month={month} onMonthChange={setMonth} onToday={goToday} />
          <WeekCalendar
            month={month}
            onMonthChange={setMonth}
            selectedWeekStart={selectedWeekStart}
            statusByStart={statusByStart}
            onPickWeek={pickWeek}
          />
          <WeekStatusLegend />
        </CardContent>
      </Card>

      <AllWeeksDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        weeks={weeks}
        selectedId={selectedId}
        onPick={(id) => {
          setAllOpen(false);
          open(id);
        }}
      />

      <ConfirmDialog
        open={createFor !== null}
        onOpenChange={(isOpen) => !isOpen && setCreateFor(null)}
        title={`Create the week of ${createFor ? formatWeekRange(createFor) : ""}?`}
        description="It starts from the Dept/Shift Template lines and the active locations. You can copy the previous week into it afterwards."
        confirmLabel="Create week"
        onConfirm={async () => {
          if (!createFor) return;
          await run(() => createWeek(createFor), "Week created", {
            onSuccess: (r) => {
              if (r.data) open(r.data);
            },
          });
        }}
      />
    </>
  );
}
