import "server-only";
import { getActiveShiftTemplates } from "@/features/scheduling/scheduling-grid/db/get-active-shift-templates";
import { insertWeekLines } from "@/features/scheduling/scheduling-grid/db/insert-week-lines";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Snapshot the active shift templates into a new week's lines. */
export async function snapshotTemplatesIntoWeek(
  supabase: DbClient,
  weekId: string,
): Promise<void> {
  const templates = await getActiveShiftTemplates(supabase);
  const lines = templates.map((t, i) => ({
    week_id: weekId,
    template_id: t.id,
    department_id: t.department_id,
    role_id: t.role_id,
    label: t.label,
    start_time: t.start_time,
    end_time: t.end_time,
    sort_order: t.sort_order ?? i,
  }));
  if (lines.length > 0) await insertWeekLines(supabase, lines);
}
