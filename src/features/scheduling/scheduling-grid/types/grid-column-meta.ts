import type { ScheduleLocation } from "@/lib/schedule/types";

/**
 * What each grid column is, carried on `columnDef.meta` so the header, cell
 * and section renderers can tell the sticky "Shift" column, the hidden
 * grouping column, a day group and a (day, location) cell column apart.
 */
export type GridColumnMeta =
  | { kind: "shift" }
  | { kind: "department" }
  | { kind: "day"; day: number }
  | { kind: "cell"; day: number; location: ScheduleLocation };
