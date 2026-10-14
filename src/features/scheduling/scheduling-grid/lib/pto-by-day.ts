import { dateForDay, gridName, type SchedPerson } from "@/lib/schedule/types";
import type { GridTimeOffRow, PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * Who is off each day (0-6), for the collapsible PTO section at the top of
 * the grid. Pending vs approved drives the chip color so the schedule admin
 * sees at a glance who has already been approved to be off. Built from the
 * raw rows (not weekTimeOff) so each chip keeps its request id for approve/deny.
 */
export function buildPtoByDay(
  timeOff: GridTimeOffRow[],
  personById: Map<string, SchedPerson>,
  weekStart: string,
): Map<number, PtoChip[]> {
  const m = new Map<number, PtoChip[]>();
  for (const r of timeOff) {
    if (r.status !== "requested" && r.status !== "approved") continue;
    const person = personById.get(r.person_id);
    if (!person) continue;
    for (let day = 0; day < 7; day++) {
      const date = dateForDay(weekStart, day);
      if (date < r.start_date || date > r.end_date) continue;
      const list = m.get(day) ?? [];
      list.push({
        person,
        status: r.status,
        requestId: r.id,
        startDate: r.start_date,
        endDate: r.end_date,
      });
      m.set(day, list);
    }
  }
  for (const list of m.values())
    list.sort((a, b) => gridName(a.person).localeCompare(gridName(b.person)));
  return m;
}
