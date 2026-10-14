import type {
  CellContext,
  Column,
  ColumnDef,
  Header,
  HeaderContext,
  ReactTable,
  Row,
} from "@tanstack/react-table";
import type { GridTableFeatures } from "@/features/scheduling/scheduling-grid/lib/grid-table-features";
import type { GridRow } from "@/features/scheduling/scheduling-grid/types/grid-row";

/** The grid's TanStack Table types, bound to its feature set and row shape. */
export type GridTable = ReactTable<GridTableFeatures, GridRow>;
export type GridTableRow = Row<GridTableFeatures, GridRow>;
export type GridColumn = Column<GridTableFeatures, GridRow, unknown>;
export type GridHeader = Header<GridTableFeatures, GridRow, unknown>;
export type GridColumnDef = ColumnDef<GridTableFeatures, GridRow, unknown>;
export type GridCellContext = CellContext<GridTableFeatures, GridRow, unknown>;
export type GridHeaderContext = HeaderContext<GridTableFeatures, GridRow, unknown>;
