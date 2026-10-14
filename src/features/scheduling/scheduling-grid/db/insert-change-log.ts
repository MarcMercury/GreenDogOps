import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Record one post-publish edit (or attendance mark) in the week's change log. */
export async function insertChangeLog(
  supabase: DbClient,
  row: {
    week_id: string;
    assignment_id: string | null;
    person_id: string | null;
    action: string;
    detail: string;
    actor_id: string | null;
    actor_email: string | null;
  },
): Promise<void> {
  await supabase.from("sched_change_log").insert(row);
}
