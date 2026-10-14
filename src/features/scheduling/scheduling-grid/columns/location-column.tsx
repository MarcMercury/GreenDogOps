import type { ScheduleLocation } from "@/lib/schedule/types";
import { gridColumnHelper } from "@/features/scheduling/scheduling-grid/columns/column-helper";
import { LocationCell } from "@/features/scheduling/scheduling-grid/components/grid/location-cell";
import { LocationHeaderCell } from "@/features/scheduling/scheduling-grid/components/grid/location-header-cell";
import { cellColumnId } from "@/features/scheduling/scheduling-grid/lib/column-visibility";

/**
 * One (day, location) column. Its header is the clinic's open / closed toggle,
 * its cells the people on each shift line that day at that clinic. Toggling a
 * location on the toolbar hides or shows its seven columns.
 */
export function locationColumn(day: number, location: ScheduleLocation) {
  return gridColumnHelper.display({
    id: cellColumnId(day, location.id),
    meta: { kind: "cell", day, location },
    header: LocationHeaderCell,
    cell: LocationCell,
  });
}
