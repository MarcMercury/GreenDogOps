"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { AttendanceStatus } from "@/lib/schedule/types";
import { runInBackground } from "@/lib/notify/emit";
import { notifyAttendanceChange } from "@/lib/notify/events/schedule";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { markAttendanceSchema } from "@/features/scheduling/scheduling-grid/schema/attendance.schema";
import { logChange } from "@/features/scheduling/scheduling-grid/server/log-change";
import { getAssignment } from "@/features/scheduling/scheduling-grid/db/get-assignment";
import { updateAttendance } from "@/features/scheduling/scheduling-grid/db/update-attendance";

/** Mark attendance for an assignment (post-publish). */
export async function markAttendance(
  assignmentId: string,
  status: AttendanceStatus,
  note: string | null,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(markAttendanceSchema, { assignmentId, status, note });
  if (!parsed.ok) return parsed;
  const mark = parsed.data;

  const supabase = await createClient();
  const me = await actor();

  const asg = await getAssignment(supabase, mark.assignmentId);

  const { error } = await updateAttendance(supabase, mark.assignmentId, {
    status: mark.status,
    note: mark.note,
    markedBy: me.id,
    markedAt: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  if (asg) {
    await logChange(asg.week_id, "attendance", `Marked ${mark.status}`, asg.person_id, mark.assignmentId);
    runInBackground(() =>
      notifyAttendanceChange({
        assignmentId: mark.assignmentId,
        status: mark.status,
        note: mark.note,
        actorUserId: me.id,
      }),
    );
  }
  revalidateSchedulePaths();
  return { ok: true };
}
