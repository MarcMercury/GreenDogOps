"use client";

import { createContext, useContext } from "react";
import type { GridContextValue } from "@/features/scheduling/scheduling-grid/types/grid-context";

/** Provided by `ScheduleGrid`; read by every header, section, row and cell renderer. */
export const GridContext = createContext<GridContextValue | null>(null);

export function useGrid(): GridContextValue {
  const value = useContext(GridContext);
  if (!value) throw new Error("useGrid() must be used inside <ScheduleGrid>.");
  return value;
}
