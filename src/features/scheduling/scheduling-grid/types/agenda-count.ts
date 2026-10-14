/** One (location, day, department) booked-appointment count from ezyVet Agenda. */
export interface AgendaCount {
  location_id: string;
  appt_date: string;
  department_id: string;
  appt_count: number;
}
