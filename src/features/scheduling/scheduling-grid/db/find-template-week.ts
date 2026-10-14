import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A saved Week Template by id. Guarded on is_template so a real week never matches. */
export async function findTemplateWeek(
  supabase: DbClient,
  templateId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("id")
    .eq("id", templateId)
    .eq("is_template", true)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
