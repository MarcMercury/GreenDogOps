import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Snapshot the active Dept/Shift Template lines (in active departments only)
 * into a freshly created template week as its shift lines.
 */
export async function snapshotShiftTemplatesIntoTemplateWeek(weekId: string): Promise<void> {
  const supabase = await createClient();
  const [{ data: templates }, { data: activeDepts }] = await Promise.all([
    supabase
      .from("sched_shift_template")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("sched_department").select("id").eq("is_active", true),
  ]);
  const activeDeptIds = new Set(
    ((activeDepts ?? []) as { id: string }[]).map((d) => d.id),
  );
  const lines = (templates ?? [])
    .filter((t: Record<string, unknown>) =>
      activeDeptIds.has(t.department_id as string),
    )
    .map((t: Record<string, unknown>, i: number) => ({
      week_id: weekId,
      template_id: t.id,
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: (t.sort_order as number) ?? i,
    }));
  if (lines.length > 0) await supabase.from("sched_week_line").insert(lines);
}
