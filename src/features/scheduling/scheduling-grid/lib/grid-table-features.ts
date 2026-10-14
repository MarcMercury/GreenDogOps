import {
  columnGroupingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createGroupedRowModel,
  rowExpandingFeature,
  tableFeatures,
} from "@tanstack/react-table";
import type { GridColumnMeta } from "@/features/scheduling/scheduling-grid/types/grid-column-meta";

/**
 * The TanStack Table features the grid opts into (v9 is tree-shaken, so each
 * one is declared): rows grouped by department (`columnGroupingFeature` +
 * `groupedRowModel`), department sections that collapse (`rowExpandingFeature`
 * + `expandedRowModel`), and location toggles as column visibility. The
 * `columnMeta` slot types `columnDef.meta` as `GridColumnMeta` everywhere.
 */
export const gridTableFeatures = tableFeatures({
  columnGroupingFeature,
  rowExpandingFeature,
  columnVisibilityFeature,
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  columnMeta: {} as GridColumnMeta,
});

export type GridTableFeatures = typeof gridTableFeatures;
