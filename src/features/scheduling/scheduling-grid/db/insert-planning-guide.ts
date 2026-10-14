import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Create a planning guide shell; returns its id or the database error. */
export async function insertPlanningGuide(
  supabase: DbClient,
  row: Record<string, unknown>,
): Promise<{ id: string; error: null } | { id: null; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("planning_guide")
    .insert(row)
    .select("id")
    .single();
  if (error) return { id: null, error };
  return { id: (data as { id: string }).id, error: null };
}
