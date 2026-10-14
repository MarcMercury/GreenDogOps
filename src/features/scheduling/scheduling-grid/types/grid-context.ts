import type {
  AttendanceStatus,
  SchedAssignment,
  SchedDepartment,
  SchedEvent,
  SchedPerson,
  SchedWeek,
  SchedWeekLine,
  WeekTimeOff,
} from "@/lib/schedule/types";
import type { SectionState } from "@/features/scheduling/scheduling-grid/hooks/use-section-transitions";
import type { CellKey } from "@/features/scheduling/scheduling-grid/types/grid";
import type { GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/** What a cell, header or section renderer may ask the grid to do. */
export interface GridActions {
  openPicker: (cell: CellKey) => void;
  openAttendance: (assignmentId: string) => void;
  openLineModal: (opts: { line: SchedWeekLine | null; deptId?: string }) => void;
  openDeptModal: (dept: SchedDepartment | null) => void;
  openEventModal: (locationId: string, day: number, title: string) => void;
  toggleClosure: (locationId: string, day: number) => void;
  removeAssignment: (assignmentId: string) => void;
  moveAssignment: (assignmentId: string, lineId: string, locationId: string, day: number) => void;
  removeLine: (line: SchedWeekLine) => void;
  /** Expand or collapse a department section (its group row), animated. */
  toggleDepartment: (row: GridTableRow) => void;
}

/**
 * Everything the table's renderers read. Column definitions are static per
 * week + location set; the per-week lookups and the handlers flow through
 * this context instead of being threaded through every column.
 */
export interface GridContextValue {
  week: SchedWeek;
  isPublished: boolean;
  canEdit: boolean;
  templateMode: boolean;
  departmentById: Map<string, SchedDepartment>;
  personById: Map<string, SchedPerson>;
  roleName: (id: string | null) => string | null;
  /** Assignments per `${lineId}|${locationId}|${day}` cell. */
  cellMap: Map<string, SchedAssignment[]>;
  weeklyCount: Map<string, number>;
  conflictReasons: Map<string, string[]>;
  weekTimeOff: WeekTimeOff;
  systemAttendance: Record<string, AttendanceStatus>;
  /** `${locationId}|${day}` of every closed location/day. */
  closureSet: Set<string>;
  eventMap: Map<string, SchedEvent>;
  /** Booked appointments per `${departmentId}|${locationId}|${date}`. */
  agendaCountMap: Map<string, number>;
  /** Open / opening / closing, per department id (and "pto"), for the row animation. */
  sectionState: (key: string) => SectionState;
  actions: GridActions;
}
