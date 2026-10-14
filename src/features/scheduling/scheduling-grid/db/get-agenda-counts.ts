import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dateForDay } from "@/lib/schedule/types";
import type { AgendaCount } from "@/features/scheduling/scheduling-grid/types/agenda-count";

/**
 * Booked-appointment counts (from the ezyVet Agenda ingest) for the seven days
 * of a schedule week. Powers the per-department demand overlay on the grid.
 */
export async function getAgendaCounts(weekStart: string): Promise<AgendaCount[]> {
  const supabase = await createClient();
  const weekEnd = dateForDay(weekStart, 6);
  const { data } = await supabase
    .from("ezyvet_agenda_count")
    .select("location_id, appt_date, department_id, appt_count")
    .gte("appt_date", weekStart)
    .lte("appt_date", weekEnd);
  return (data ?? []) as AgendaCount[];
}
