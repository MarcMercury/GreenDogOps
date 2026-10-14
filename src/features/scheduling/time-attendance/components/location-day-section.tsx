import { locationStats, sortShiftRows } from "@/features/scheduling/time-attendance/lib/location-stats";
import type { LocationGroup } from "@/features/scheduling/time-attendance/types/location-group";
import { GradedShiftTable } from "@/features/scheduling/time-attendance/components/graded-shift-table";
import { LocationStatGrid } from "@/features/scheduling/time-attendance/components/location-stat-grid";

/** One clinic's day: the headline numbers, then every shift in start-time order. */
export function LocationDaySection({ group }: { group: LocationGroup }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{group.name}</h2>
      <LocationStatGrid stats={locationStats(group.rows)} />
      <GradedShiftTable rows={sortShiftRows(group.rows)} />
    </section>
  );
}
