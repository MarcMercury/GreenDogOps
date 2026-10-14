"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import { dateForDay } from "@/lib/schedule/types";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  assignPersonSchema,
  moveAssignmentSchema,
  removeAssignmentSchema,
} from "@/features/scheduling/scheduling-grid/schema/assignment.schema";
import { logChange } from "@/features/scheduling/scheduling-grid/server/log-change";
import { clearAutoAbsences } from "@/features/scheduling/scheduling-grid/db/clear-auto-absences";
import { countOtherShiftsSameDay } from "@/features/scheduling/scheduling-grid/db/count-other-shifts-same-day";
import { deleteAssignment } from "@/features/scheduling/scheduling-grid/db/delete-assignment";
import { findActiveAssignment } from "@/features/scheduling/scheduling-grid/db/find-active-assignment";
import { findWeekLine } from "@/features/scheduling/scheduling-grid/db/find-week-line";
import { getAssignment } from "@/features/scheduling/scheduling-grid/db/get-assignment";
import { getWeekStatus } from "@/features/scheduling/scheduling-grid/db/get-week-status";
import { insertAssignment } from "@/features/scheduling/scheduling-grid/db/insert-assignment";
import { markRemovedPostPublish } from "@/features/scheduling/scheduling-grid/db/mark-removed-post-publish";
import { updateAssignmentCell } from "@/features/scheduling/scheduling-grid/db/update-assignment-cell";

// The three grid mutations live together because a drag on a published week
// is defined in terms of the other two (see moveAssignment).

/** Place a person into a (line, location, day) cell. */
export async function assignPerson(
  weekId: string,
  lineId: string,
  locationId: string,
  dayOfWeek: number,
  personId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(assignPersonSchema, {
    weekId,
    lineId,
    locationId,
    dayOfWeek,
    personId,
  });
  if (!parsed.ok) return parsed;
  const cell = parsed.data;

  const supabase = await createClient();
  const me = await actor();

  const week = await getWeekStatus(supabase, cell.weekId);
  if (!week) return { ok: false, error: "Week not found." };
  const isPublished = week.status === "published";
  const isPendingApproval = week.status === "pending_approval";
  const workDate = dateForDay(week.week_start, cell.dayOfWeek);

  // Already in this exact cell? No-op.
  const dupe = await findActiveAssignment(supabase, cell);
  if (dupe) return { ok: true };

  const row = await insertAssignment(supabase, {
    week_id: cell.weekId,
    line_id: cell.lineId,
    location_id: cell.locationId,
    person_id: cell.personId,
    day_of_week: cell.dayOfWeek,
    work_date: workDate,
    added_post_publish: isPublished,
    changed_after_approval: isPendingApproval,
    created_by: me.id,
  });
  if (row.error) return { ok: false, error: row.error.message };

  if (isPublished) {
    // A relocation resolves any auto-absence recorded earlier the same day.
    await clearAutoAbsences(supabase, cell.weekId, cell.personId, workDate);

    await logChange(
      cell.weekId,
      "added",
      "Added after publish",
      cell.personId,
      row.id,
      workDate,
    );
  }

  revalidateSchedulePaths();
  return { ok: true };
}

/**
 * Remove a person from a cell. On a published week this applies the absence
 * rules: if the person has no other shift that day it becomes an auto-absence
 * (kept + flagged); otherwise it is a relocation and the row is deleted.
 */
export async function removeAssignment(
  assignmentId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(removeAssignmentSchema, { assignmentId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();

  const a = await getAssignment(supabase, parsed.data.assignmentId);
  if (!a) return { ok: true };

  const week = await getWeekStatus(supabase, a.week_id);
  const isPublished = week?.status === "published";

  // Draft week, or a row that was itself added post-publish: just delete it.
  if (!isPublished || a.added_post_publish) {
    const { error } = await deleteAssignment(supabase, a.id);
    if (error) return { ok: false, error: error.message };
    if (isPublished)
      await logChange(a.week_id, "removed", "Removed after publish", a.person_id, null, a.work_date);
    revalidateSchedulePaths();
    return { ok: true };
  }

  // Does the person still have another active shift the same day?
  const relocated =
    (await countOtherShiftsSameDay(supabase, {
      weekId: a.week_id,
      personId: a.person_id,
      workDate: a.work_date,
      excludeId: a.id,
    })) > 0;

  if (relocated) {
    const { error } = await deleteAssignment(supabase, a.id);
    if (error) return { ok: false, error: error.message };
    await logChange(
      a.week_id,
      "relocated",
      "Removed but working elsewhere that day",
      a.person_id,
      null,
      a.work_date,
    );
  } else {
    const { error } = await markRemovedPostPublish(supabase, a.id);
    if (error) return { ok: false, error: error.message };
    await logChange(
      a.week_id,
      "auto_absent",
      "Auto-marked absent (removed after publish)",
      a.person_id,
      a.id,
      a.work_date,
    );
  }
  revalidateSchedulePaths();
  return { ok: true };
}

/**
 * Move an existing assignment to a different (line, location, day) cell.
 * Drives the drag-and-drop interaction. All mutations run behind the same
 * `ensureCanEdit("schedule")` gate as the rest of the grid, and the source
 * assignment is re-validated server-side so a client can never relocate a row
 * it has no business touching.
 *
 * On a draft week the row is simply re-pointed at the target cell. On a
 * published week the move is delegated to the existing publish-aware
 * `assignPerson` / `removeAssignment` helpers so absence/relocation rules and
 * the change log stay consistent with manual edits.
 */
export async function moveAssignment(
  assignmentId: string,
  targetLineId: string,
  targetLocationId: string,
  targetDay: number,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(moveAssignmentSchema, {
    assignmentId,
    targetLineId,
    targetLocationId,
    targetDay,
  });
  if (!parsed.ok) return parsed;
  const target = parsed.data;

  const supabase = await createClient();

  // Re-load the source row server-side — never trust client-supplied context.
  const a = await getAssignment(supabase, target.assignmentId);
  if (!a) return { ok: false, error: "Assignment not found." };

  // A row already removed post-publish is an absence record, not a live shift.
  if (a.removed_post_publish)
    return { ok: false, error: "That assignment is no longer active." };

  // No-op if dropped back onto its own cell.
  if (
    a.line_id === target.targetLineId &&
    a.location_id === target.targetLocationId &&
    a.day_of_week === target.targetDay
  )
    return { ok: true };

  const w = await getWeekStatus(supabase, a.week_id);
  if (!w) return { ok: false, error: "Week not found." };
  const isPublished = w.status === "published";
  const isPendingApproval = w.status === "pending_approval";

  // Validate the target line + location actually belong to this week so a
  // crafted request can't relocate someone onto an unrelated week/shift.
  const targetLine = await findWeekLine(supabase, target.targetLineId, a.week_id);
  if (!targetLine) return { ok: false, error: "Invalid target shift." };

  const targetDate = dateForDay(w.week_start, target.targetDay);

  // Already an active row for this person in the target cell? Treat the drag
  // as a consolidation: drop the source so we don't create a duplicate.
  const dupe = await findActiveAssignment(supabase, {
    lineId: target.targetLineId,
    locationId: target.targetLocationId,
    dayOfWeek: target.targetDay,
    personId: a.person_id,
    excludeId: a.id,
  });

  // Draft week (or a row added after publish): re-point the row in place,
  // preserving its history. If it would collide with an existing row, delete
  // the source instead.
  if (!isPublished || a.added_post_publish) {
    if (dupe) {
      const { error } = await deleteAssignment(supabase, a.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await updateAssignmentCell(supabase, a.id, {
        line_id: target.targetLineId,
        location_id: target.targetLocationId,
        day_of_week: target.targetDay,
        work_date: targetDate,
        ...(isPendingApproval ? { changed_after_approval: true } : {}),
      });
      if (error) return { ok: false, error: error.message };
      if (isPublished)
        await logChange(
          a.week_id,
          "relocated",
          "Moved via drag-and-drop",
          a.person_id,
          a.id,
          targetDate,
        );
    }
    revalidateSchedulePaths();
    return { ok: true };
  }

  // Published week, original row: delegate to the publish-aware helpers so the
  // target gets a properly flagged add and the source applies relocation /
  // auto-absence rules and change-log entries exactly like a manual edit.
  const placed = await assignPerson(
    a.week_id,
    target.targetLineId,
    target.targetLocationId,
    target.targetDay,
    a.person_id,
  );
  if (!placed.ok) return placed;
  return removeAssignment(a.id);
}
