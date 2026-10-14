import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UnscheduledWork as UnscheduledWorkItem } from "@/lib/timeclock/attendance-server";
import { formatDuration } from "@/lib/timeclock/timecard";
import { shortDateLabel } from "@/lib/worklist/dates";
import { t } from "@/features/scheduling/time-attendance/server/format-clock";

/** Sessions that day that matched no published shift (unscheduled clock-ins are allowed). */
export function UnscheduledWork({ date, items }: { date: string; items: UnscheduledWorkItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Unscheduled work</CardTitle>
        <CardDescription className="text-xs">
          Punches on {shortDateLabel(date)} that don&apos;t match a published shift.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {items.map((u, i) => (
            <li key={`${u.person_id}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="text-foreground">{u.person_name}</span>
              <span className="tabular-nums text-muted-foreground">
                {t(u.session.clock_in)} – {t(u.session.clock_out)}
                {u.session.worked_ms != null ? ` · ${formatDuration(u.session.worked_ms)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
