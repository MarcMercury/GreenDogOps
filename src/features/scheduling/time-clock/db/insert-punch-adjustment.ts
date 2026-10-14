import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PunchType } from "@/lib/timeclock/state";

/**
 * Add a missing punch as an append-only `time_punch_adjustment` row (action
 * "add"); the original punches are never edited.
 */
export async function insertPunchAdjustment(row: {
  personId: string;
  punchType: PunchType;
  punchedAt: string;
  workDate: string;
  reason: string;
  createdBy: string;
}): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { data, error } = await createAdminClient()
    .from("time_punch_adjustment")
    .insert({
      person_id: row.personId,
      action: "add",
      punch_type: row.punchType,
      punched_at: row.punchedAt,
      work_date: row.workDate,
      reason: row.reason,
      created_by: row.createdBy,
    })
    .select("id")
    .single();
  return { data: (data as { id: string } | null) ?? null, error };
}
