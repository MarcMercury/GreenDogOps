import { createColumnHelper } from "@tanstack/react-table";
import type { GridTableFeatures } from "@/features/scheduling/scheduling-grid/lib/grid-table-features";
import type { GridRow } from "@/features/scheduling/scheduling-grid/types/grid-row";

/** Column helper bound to the grid's features and row type, shared by every column file. */
export const gridColumnHelper = createColumnHelper<GridTableFeatures, GridRow>();
