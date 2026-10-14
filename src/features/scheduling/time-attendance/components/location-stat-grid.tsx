import type { LocationStats } from "@/features/scheduling/time-attendance/lib/location-stats";
import { Stat } from "@/features/scheduling/time-attendance/components/stat";

/** The eight numbers above a clinic's table; amber / red only when there is something to act on. */
export function LocationStatGrid({ stats }: { stats: LocationStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      <Stat label="Scheduled" value={stats.scheduled} />
      <Stat label="Clocked in" value={stats.working} tone="text-emerald-700" />
      <Stat label="Not in yet" value={stats.notInYet} tone={stats.notInYet ? "text-amber-700" : ""} />
      <Stat label="Late" value={stats.late} tone={stats.late ? "text-amber-700" : ""} />
      <Stat label="Missed" value={stats.missed} tone={stats.missed ? "text-red-700" : ""} />
      <Stat label="Done" value={stats.done} />
      <Stat label="PTO" value={stats.pto} />
      <Stat label="Punch match" value={stats.punchMatchLabel} />
    </div>
  );
}
