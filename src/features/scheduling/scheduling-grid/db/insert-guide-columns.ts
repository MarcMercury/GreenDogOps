import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert a guide's columns (tracks) and return them with their ids. */
export async function insertGuideColumns(
  supabase: DbClient,
  rows: {
    guide_id: string;
    name: string;
    color: string;
    capacity_note: string | null;
    sort_order: number;
  }[],
) {
  const { data, error } = await supabase
    .from("planning_guide_column")
    .insert(rows)
    .select("id, name, sort_order");
  return {
    data: (data ?? []) as { id: string; name: string; sort_order: number }[],
    error,
  };
}
