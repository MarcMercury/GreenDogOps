import "server-only";
import { createClient } from "@/lib/supabase/server";
import { runInBackground } from "@/lib/notify/emit";
import {
  notifyAttendanceChange,
  notifyShiftChanged,
} from "@/lib/notify/events/schedule";
import { actor } from "@/features/scheduling/shared/server/actor";
import { insertChangeLog } from "@/features/scheduling/scheduling-grid/db/insert-change-log";

/**
 * Record a post-publish edit in `sched_change_log` and tell the people it
 * affects: the employee (batched) for any change to their shifts, and the
 * attendance audience when a removal turned into an auto-absence.
 */
export async function logChange(
  weekId: string,
  action: string,
  detail: string,
  personId: string | null,
  assignmentId: string | null,
  workDate: string | null = null,
) {
  const supabase = await createClient();
  const me = await actor();
  await insertChangeLog(supabase, {
    week_id: weekId,
    assignment_id: assignmentId,
    person_id: personId,
    action,
    detail,
    actor_id: me.id,
    actor_email: me.email,
  });
  // Post-publish edits: tell the employee (batched), and flag an open shift.
  if (personId && action !== "attendance") {
    runInBackground(() =>
      notifyShiftChanged({ weekId, personId, action, workDate, actorUserId: me.id }),
    );
  }
  if (action === "auto_absent" && assignmentId) {
    runInBackground(() =>
      notifyAttendanceChange({ assignmentId, status: "auto_absent", actorUserId: me.id }),
    );
  }
}
