import type { ScheduleLocation } from "@/lib/schedule/types";
import { gridColumnHelper } from "@/features/scheduling/scheduling-grid/columns/column-helper";
import { locationColumn } from "@/features/scheduling/scheduling-grid/columns/location-column";
import { DayHeader } from "@/features/scheduling/scheduling-grid/components/grid/day-header";

/** A day of the week: a header group spanning that day's location columns. */
export function dayGroupColumn(day: number, locations: ScheduleLocation[]) {
  return gridColumnHelper.group({
    id: `day:${day}`,
    meta: { kind: "day", day },
    header: DayHeader,
    columns: locations.map((location) => locationColumn(day, location)),
  });
}
