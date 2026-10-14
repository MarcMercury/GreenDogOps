import { gridColumnHelper } from "@/features/scheduling/scheduling-grid/columns/column-helper";

/**
 * The column the rows are grouped by. Never shown: `groupedColumnMode:
 * "remove"` takes it out of the visible columns, and its group rows render as
 * the department section headers (`DeptSectionRow`).
 */
export const departmentColumn = gridColumnHelper.accessor((row) => row.departmentId, {
  id: "departmentId",
  header: "",
  meta: { kind: "department" },
  enableGrouping: true,
});
