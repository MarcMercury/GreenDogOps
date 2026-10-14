import type { AttendanceSettings } from "@/lib/timeclock/attendance-server";
import { shortDateLabel } from "@/lib/worklist/dates";

/**
 * Whether these grades count yet — shadow mode until an Admin sets the go-live
 * date in Admin ▸ Settings ▸ Time clock — and the lateness thresholds in force.
 */
export function AttendanceModeBanner({ settings }: { settings: AttendanceSettings }) {
  return (
    <p
      role="status"
      className={`rounded-lg px-4 py-2.5 text-xs ${settings.liveFrom ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"}`}
    >
      {settings.liveFrom
        ? `Time-clock attendance counts from ${shortDateLabel(settings.liveFrom)}: unmarked shifts use these grades for reliability and the grid, and missed / late alerts are sent.`
        : "Shadow mode: these grades are shown here only. Reliability, the grid and alerts still use managers' marks until an Admin sets “Use time-clock attendance from” (Admin ▸ Settings ▸ Time clock)."}{" "}
      Late after {settings.thresholds.lateGraceMinutes} min, very late after {settings.thresholds.veryLateMinutes} min,
      missed after {settings.thresholds.missedAfterMinutes} min with no clock-in.
    </p>
  );
}
