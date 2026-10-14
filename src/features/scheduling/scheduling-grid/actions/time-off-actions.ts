"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import { runInBackground } from "@/lib/notify/emit";
import { notifyTimeOffDecided } from "@/lib/notify/events/schedule";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { setTimeOffStatusSchema } from "@/features/scheduling/scheduling-grid/schema/time-off.schema";
import { getTimeOffStatus } from "@/features/scheduling/scheduling-grid/db/get-time-off-status";
import { updateTimeOffStatus } from "@/features/scheduling/scheduling-grid/db/update-time-off-status";

/**
 * Approve or deny a pending PTO request straight from the grid's PTO section.
 * Denied requests drop out of the time-off overlay (getWeekTimeOff only pulls
 * requested/approved), so the person becomes schedulable again for that day.
 */
export async function setTimeOffStatus(
  id: string,
  status: "approved" | "denied",
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(setTimeOffStatusSchema, { id, status });
  if (!parsed.ok) return parsed;
  const decision = parsed.data;

  const supabase = await createClient();
  const me = await actor();
  const before = await getTimeOffStatus(supabase, decision.id);
  const { error } = await updateTimeOffStatus(supabase, decision.id, {
    status: decision.status,
    reviewed_by: me.id,
    reviewed_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  if (before?.status !== decision.status) {
    const reviewerName = gate.current.appUser.full_name?.trim() || gate.current.email;
    runInBackground(() =>
      notifyTimeOffDecided({
        timeOffId: decision.id,
        status: decision.status,
        reviewerName,
        actorUserId: me.id,
      }),
    );
  }
  revalidateSchedulePaths();
  return { ok: true };
}
