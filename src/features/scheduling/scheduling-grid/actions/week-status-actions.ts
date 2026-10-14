"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit, recordAudit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ScheduleStatus } from "@/lib/schedule/types";
import { runInBackground } from "@/lib/notify/emit";
import { notifySchedulePublished } from "@/lib/notify/events/schedule";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { setWeekStatusSchema } from "@/features/scheduling/scheduling-grid/schema/week-status.schema";
import type { SetWeekStatusResult } from "@/features/scheduling/scheduling-grid/types/set-week-status-result";
import { getUntimedShiftsInWeek } from "@/features/scheduling/scheduling-grid/db/get-untimed-shifts-in-week";
import { getWeekStatus } from "@/features/scheduling/scheduling-grid/db/get-week-status";
import { resetChangedAfterApproval } from "@/features/scheduling/scheduling-grid/db/reset-changed-after-approval";
import { updateWeekStatus } from "@/features/scheduling/scheduling-grid/db/update-week-status";

/**
 * Move a week through the workflow: submit / approve / publish / reopen.
 * Publishing a week with untimed shifts returns `untimed` so the grid can ask
 * "Publish anyway?"; the override is audited.
 */
export async function setWeekStatus(
  weekId: string,
  status: ScheduleStatus,
  options?: { confirmUntimed?: boolean },
): Promise<SetWeekStatusResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(setWeekStatusSchema, {
    weekId,
    status,
    confirmUntimed: options?.confirmUntimed,
  });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const me = await actor();
  const now = new Date().toISOString();
  const prior = await getWeekStatus(supabase, parsed.data.weekId);
  const wasPublished = prior?.status === "published";

  // Lateness can't be graded on a shift without times; make that a choice.
  let untimed: string[] = [];
  if (parsed.data.status === "published" && !wasPublished) {
    untimed = await getUntimedShiftsInWeek(supabase, parsed.data.weekId);
    if (untimed.length > 0 && !parsed.data.confirmUntimed) {
      return {
        ok: false,
        error: `${untimed.length} shift${untimed.length === 1 ? " has" : "s have"} no start or end time, so lateness can't be checked on ${untimed.length === 1 ? "it" : "them"}.`,
        untimed,
      };
    }
  }

  const patch: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === "pending_approval") {
    patch.submitted_by = me.id;
    patch.submitted_at = now;
  } else if (parsed.data.status === "approved") {
    patch.approved_by = me.id;
    patch.approved_at = now;
  } else if (parsed.data.status === "published") {
    patch.published_by = me.id;
    patch.published_at = now;
  } else if (parsed.data.status === "draft") {
    patch.submitted_at = null;
    patch.approved_at = null;
  }

  const { error } = await updateWeekStatus(supabase, parsed.data.weekId, patch);
  if (error) return { ok: false, error: error.message };
  if (parsed.data.status === "published" && !wasPublished) {
    runInBackground(() => notifySchedulePublished(parsed.data.weekId, me.id));
    if (untimed.length > 0) {
      await recordAudit({
        actorId: gate.current.authId,
        actorEmail: gate.current.email,
        action: "schedule.published_untimed",
        entity: "sched_week",
        entityId: parsed.data.weekId,
        summary: `Published the week of ${prior?.week_start ?? ""} with ${untimed.length} shift(s) missing times`,
        metadata: { untimed: untimed.slice(0, 50) },
      });
    }
  }

  // Each workflow transition starts a clean baseline: only edits made while the
  // week sits in "Pending Approval" get the light-blue "changed" cue.
  await resetChangedAfterApproval(supabase, parsed.data.weekId);

  revalidateSchedulePaths();
  return { ok: true };
}
