import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { locationStats, sortShiftRows } from "@/features/scheduling/time-attendance/lib/location-stats";
import type { LocationGroup } from "@/features/scheduling/time-attendance/types/location-group";
import { GradedShiftTable } from "@/features/scheduling/time-attendance/components/graded-shift-table";
import { LocationStatGrid } from "@/features/scheduling/time-attendance/components/location-stat-grid";

/** One clinic's day: the headline numbers, then every shift in start-time order. */
export function LocationDaySection({ group }: { group: LocationGroup }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{group.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <LocationStatGrid stats={locationStats(group.rows)} />
        <GradedShiftTable rows={sortShiftRows(group.rows)} />
      </CardContent>
    </Card>
  );
}
