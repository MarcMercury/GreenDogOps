import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TimeClockRpcResult } from "@/features/scheduling/time-clock/types/rpc-result";

/**
 * Record an approver's decision on an off-site punch through the atomic
 * `review_time_punch` function (a reject also voids the punch). Returns the
 * function's `{ ok, error? }` payload, or the PostgREST error.
 */
export async function reviewTimePunch(input: {
  punchId: string;
  decision: "approved" | "rejected";
  note: string;
  reviewerId: string;
}): Promise<{ data: TimeClockRpcResult | null; error: { message: string } | null }> {
  const { data, error } = await createAdminClient().rpc("review_time_punch", {
    p_punch_id: input.punchId,
    p_decision: input.decision,
    p_note: input.note?.slice(0, 1000) ?? null,
    p_reviewer: input.reviewerId,
  });
  return { data: (data as TimeClockRpcResult | null) ?? null, error };
}
