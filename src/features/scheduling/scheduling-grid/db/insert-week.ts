import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Create a draft week starting on `weekStart`; returns its id or the database error. */
export async function insertWeek(
  supabase: DbClient,
  weekStart: string,
  createdBy: string | null,
): Promise<{ id: string; error: null } | { id: null; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("sched_week")
    .insert({ week_start: weekStart, status: "draft", created_by: createdBy })
    .select("id")
    .single();
  if (error) return { id: null, error };
  return { id: (data as { id: string }).id, error: null };
}
