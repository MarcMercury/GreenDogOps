"use client";

import { useMemo } from "react";
import { cn } from "cn";
import { getDefaultClassNames, type CustomComponents } from "react-day-picker";
import { weekStartFor, type ScheduleStatus } from "@/lib/schedule/types";
import { Calendar } from "@/components/ui/calendar";
import { WeekStatusDot } from "@/features/scheduling/scheduling-grid/components/sidebar/week-status-dot";

/**
 * The month calendar that picks a *week*. Built on the shadcn `Calendar`
 * (react-day-picker) with three adjustments: the week-number column renders
 * each week's status dot instead of a number, the row of the open week is a
 * navy pill, and clicking any day picks the week it belongs to.
 */
export function WeekCalendar({
  month,
  onMonthChange,
  selectedWeekStart,
  statusByStart,
  onPickWeek,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  /** `YYYY-MM-DD` Sunday of the open week, if any. */
  selectedWeekStart: string | null;
  statusByStart: Map<string, ScheduleStatus>;
  onPickWeek: (weekStart: string) => void;
}) {
  const defaults = getDefaultClassNames();

  // The row-level components close over the open week and the statuses; they
  // are memoised so DayPicker keeps its cells mounted across renders.
  const components = useMemo<Partial<CustomComponents>>(
    () => ({
      Week: ({ week, className, children, ...props }) => {
        const selected = weekStartFor(week.days[0].date) === selectedWeekStart;
        return (
          <tr
            {...props}
            data-selected-week={selected || undefined}
            className={cn(className, selected ? "bg-slate-900 text-white shadow-sm" : "hover:bg-slate-100")}
          >
            {children}
          </tr>
        );
      },
      // The week number's slot shows the week's status instead.
      WeekNumber: ({ week, className, ...props }) => (
        <th {...props} className={cn(className, "flex items-center justify-center")}>
          <WeekStatusDot status={statusByStart.get(weekStartFor(week.days[0].date)) ?? null} />
        </th>
      ),
      WeekNumberHeader: ({ className, ...props }) => (
        <th {...props} className={cn(className)} aria-hidden>
          {null}
        </th>
      ),
    }),
    [selectedWeekStart, statusByStart],
  );

  return (
    <Calendar
      month={month}
      onMonthChange={onMonthChange}
      hideNavigation
      showOutsideDays
      showWeekNumber
      weekStartsOn={0}
      onDayClick={(date) => onPickWeek(weekStartFor(date))}
      formatters={{
        formatWeekdayName: (date) => date.toLocaleDateString(undefined, { weekday: "narrow" }),
      }}
      classNames={{
        root: cn("w-full", defaults.root),
        month_caption: "hidden",
        nav: "hidden",
        week: cn("mt-1 flex w-full items-center rounded-lg transition-colors", defaults.week),
        week_number_header: cn("w-6 shrink-0", defaults.week_number_header),
        week_number: cn("w-6 shrink-0 text-center", defaults.week_number),
        weekday: cn(
          "flex-1 text-center text-[11px] font-semibold uppercase text-slate-400 select-none",
          defaults.weekday,
        ),
        // Today: a green underline, legible on the navy pill too.
        today: cn(
          "[&_button]:font-semibold [&_button]:underline [&_button]:decoration-emerald-500 [&_button]:decoration-2 [&_button]:underline-offset-4",
          defaults.today,
        ),
        outside: cn("text-muted-foreground", defaults.outside),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-md p-0 text-center select-none [&_button]:text-sm [&_button]:font-medium",
          defaults.day,
        ),
      }}
      // The open week: every day in the pill reads white, whatever its own state.
      modifiers={{ selectedWeek: selectedWeekStart ? weekRange(selectedWeekStart) : [] }}
      modifiersClassNames={{
        selectedWeek: "[&_button]:text-white! [&_button:hover]:bg-white/15 [&_button:hover]:text-white!",
      }}
      components={components}
      className="w-full p-0 [--cell-size:--spacing(9)]"
    />
  );
}

/** The seven local dates of a `YYYY-MM-DD` Sunday-start week. */
function weekRange(weekStart: string): { from: Date; to: Date } {
  const [y, m, d] = weekStart.split("-").map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 6);
  return { from, to };
}
