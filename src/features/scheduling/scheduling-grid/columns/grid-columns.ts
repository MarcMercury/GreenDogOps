import type { ScheduleLocation } from "@/lib/schedule/types";
import { gridColumnHelper } from "@/features/scheduling/scheduling-grid/columns/column-helper";
import { dayGroupColumn } from "@/features/scheduling/scheduling-grid/columns/day-group-column";
import { departmentColumn } from "@/features/scheduling/scheduling-grid/columns/department-column";
import { shiftColumn } from "@/features/scheduling/scheduling-grid/columns/shift-column";
import { DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";

/**
 * The grid's column tree: the sticky shift column, the hidden grouping column,
 * then Sunday–Saturday, each a group of the available locations. Built once
 * per set of locations (memoised by `ScheduleGrid`); which locations show is
 * column visibility, not a different column set.
 */
export function buildGridColumns(locations: ScheduleLocation[]) {
  return gridColumnHelper.columns([
    shiftColumn,
    departmentColumn,
    ...DAYS.map((day) => dayGroupColumn(day, locations)),
  ]);
}
