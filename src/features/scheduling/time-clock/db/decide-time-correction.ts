import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TimeClockRpcResult } from "@/features/scheduling/time-clock/types/rpc-result";

/**
 * Record an approver's decision on a correction request through the atomic
 * `decide_time_correction` function, optionally voiding the punch (or earlier
 * adjustment) the corrected time replaces. Returns the function's
 * `{ ok, error? }` payload, or the PostgREST error.
 */
export async function decideTimeCorrection(input: {
  requestId: string;
  decision: "approved" | "denied";
  note: string;
  reviewerId: string;
  replacePunchId: string | null;
  replaceAdjustmentId: string | null;
}): Promise<{ data: TimeClockRpcResult | null; error: { message: string } | null }> {
  const { data, error } = await createAdminClient().rpc("decide_time_correction", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_note: input.note?.slice(0, 1000) ?? null,
    p_reviewer: input.reviewerId,
    p_replace_punch_id: input.replacePunchId,
    p_replace_adjustment_id: input.replaceAdjustmentId,
  });
  return { data: (data as TimeClockRpcResult | null) ?? null, error };
}
