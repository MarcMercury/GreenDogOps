import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Place a person into a cell; returns the new row's id or the database error. */
export async function insertAssignment(
  supabase: DbClient,
  row: {
    week_id: string;
    line_id: string;
    location_id: string;
    person_id: string;
    day_of_week: number;
    work_date: string;
    added_post_publish: boolean;
    changed_after_approval: boolean;
    created_by: string | null;
  },
): Promise<{ id: string; error: null } | { id: null; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("sched_assignment")
    .insert(row)
    .select("id")
    .single();
  if (error) return { id: null, error };
  return { id: (data as { id: string }).id, error: null };
}
