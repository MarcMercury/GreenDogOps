import type { AttendanceTotals } from "@/features/scheduling/attendance/types/attendance-totals";
import { AttendanceStat } from "@/features/scheduling/attendance/components/attendance-stat";

/** The company-wide Present / Late / Absent / No-show tiles above the table. */
export function AttendanceTotalsGrid({ totals }: { totals: AttendanceTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <AttendanceStat label="Present" value={totals.present} tone="text-emerald-600" />
      <AttendanceStat label="Late" value={totals.late} tone="text-amber-600" />
      <AttendanceStat label="Absent" value={totals.absent} tone="text-red-600" />
      <AttendanceStat label="No-show" value={totals.no_show} tone="text-red-700" />
    </div>
  );
}
