import type { SchedPerson } from "@/lib/schedule/types";

/** Identifies one (shift line, location, day) cell on the grid. */
export interface CellKey {
  lineId: string;
  locationId: string;
  day: number;
}

/** One clickable PTO chip in the grid's time-off section. */
export interface PtoChip {
  person: SchedPerson;
  status: "requested" | "approved";
  requestId: string;
  startDate: string;
  endDate: string;
}

/**
 * The time-off rows the grid overlays on the week. `person_time_off` rows
 * satisfy this; the Week Template passes an empty list.
 */
export interface GridTimeOffRow {
  id: string;
  person_id: string;
  status: string;
  start_date: string;
  end_date: string;
}

/** One shift on the per-employee printout. */
export interface EmployeeShift {
  day: number;
  date: string;
  start: string | null;
  end: string | null;
  location: string;
  position: string;
}

/** One employee's week on the per-employee printout. */
export interface EmployeeSchedule {
  person: SchedPerson;
  shifts: EmployeeShift[];
}
