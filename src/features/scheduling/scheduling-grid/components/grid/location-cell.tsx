"use client";

import { GridCell } from "@/features/scheduling/scheduling-grid/components/grid/grid-cell";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridCellContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * The cell renderer of a (day, location) column: looks up the assignments for
 * this shift line in this cell and hands them, with the week's lookups and
 * handlers, to `GridCell`, which draws the `<td>` itself (it owns the width,
 * background and drag-and-drop handlers).
 */
export function LocationCell({ row, column }: GridCellContext) {
  const grid = useGrid();
  const meta = column.columnDef.meta;
  const data = row.original;
  if (meta?.kind !== "cell" || data.kind !== "line") return null;
  const { day, location } = meta;
  const { line } = data;
  const isDayStart = meta === firstCellMetaOfDay(column, day);
  return (
    <GridCell
      closed={grid.closureSet.has(`${location.id}|${day}`)}
      accent={location.color ?? "#cbd5e1"}
      isDayStart={isDayStart}
      assignments={grid.cellMap.get(`${line.id}|${location.id}|${day}`) ?? []}
      personById={grid.personById}
      weeklyCount={grid.weeklyCount}
      conflictReasons={grid.conflictReasons}
      weekTimeOff={grid.weekTimeOff}
      isPublished={grid.isPublished}
      systemAttendance={grid.systemAttendance}
      canEdit={grid.canEdit}
      onAdd={() => grid.actions.openPicker({ lineId: line.id, locationId: location.id, day })}
      onRemove={(id) => grid.actions.removeAssignment(id)}
      onMovePerson={(assignmentId) => grid.actions.moveAssignment(assignmentId, line.id, location.id, day)}
      onAttendance={(id) => grid.actions.openAttendance(id)}
    />
  );
}

/** The meta of the first visible column of `day` — that column gets the heavier day border. */
function firstCellMetaOfDay(column: GridCellContext["column"], day: number) {
  const first = column.parent?.columns.find((c) => c.getIsVisible());
  const meta = first?.columnDef.meta;
  return meta?.kind === "cell" && meta.day === day ? meta : null;
}
