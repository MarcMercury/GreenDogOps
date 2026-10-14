"use client";

import { useCallback, useState } from "react";
import type { SchedDepartment, SchedWeekLine, ScheduleStatus } from "@/lib/schedule/types";
import type { CellKey, PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/** Which dialog is open, and with what. At most one is non-null at a time in practice. */
export interface GridUiState {
  picker: CellKey | null;
  attendanceId: string | null;
  ptoMenu: { chip: PtoChip; day: number } | null;
  lineModal: { line: SchedWeekLine | null; deptId?: string } | null;
  deptModal: { dept: SchedDepartment | null } | null;
  eventModal: { locationId: string; day: number; title: string } | null;
  /** "Publish anyway?" — the shifts without times the publish stopped on. */
  publishConfirm: { status: ScheduleStatus; untimed: string[]; error: string } | null;
  lineDelete: SchedWeekLine | null;
}

const CLOSED: GridUiState = {
  picker: null,
  attendanceId: null,
  ptoMenu: null,
  lineModal: null,
  deptModal: null,
  eventModal: null,
  publishConfirm: null,
  lineDelete: null,
};

/** The grid's dialog state and a partial setter (`patch({ picker: null })`). */
export function useGridUiState(): [GridUiState, (patch: Partial<GridUiState>) => void] {
  const [ui, setUi] = useState<GridUiState>(CLOSED);
  const patch = useCallback((p: Partial<GridUiState>) => setUi((prev) => ({ ...prev, ...p })), []);
  return [ui, patch];
}
