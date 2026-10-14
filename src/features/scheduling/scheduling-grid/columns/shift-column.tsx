import { gridColumnHelper } from "@/features/scheduling/scheduling-grid/columns/column-helper";
import { ShiftLineCell } from "@/features/scheduling/scheduling-grid/components/grid/shift-line-cell";

/**
 * The sticky first column: the shift line's name and time, with its edit /
 * delete controls. Rendered as the row header (`<th scope="row">`) by
 * `ShiftLineRow`; the header cell spans the three header rows in `GridHeader`.
 */
export const shiftColumn = gridColumnHelper.display({
  id: "shift",
  header: "Shift",
  meta: { kind: "shift" },
  cell: ShiftLineCell,
});
