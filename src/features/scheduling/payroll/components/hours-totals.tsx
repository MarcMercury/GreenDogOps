import type { EmployeePeriod } from "@/lib/payroll/server";
import { formatHours } from "@/features/scheduling/payroll/lib/hours";
import { sumTotals, type HoursBucket } from "@/features/scheduling/payroll/lib/period-summary";

const TILES: { label: string; bucket: HoursBucket }[] = [
  { label: "Regular", bucket: "regular" },
  { label: "Overtime", bucket: "overtime" },
  { label: "Double time", bucket: "doubleTime" },
  { label: "Worked", bucket: "worked" },
];

/** Regular / overtime / double time / worked hours, summed across the period's timecards. */
export function HoursTotals({ rows }: { rows: EmployeePeriod[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {TILES.map((t) => (
        <div key={t.bucket} className="rounded-lg bg-muted px-3 py-2">
          {t.label} <span className="block text-lg font-semibold tabular-nums">{formatHours(sumTotals(rows, t.bucket))}</span>
        </div>
      ))}
    </div>
  );
}
