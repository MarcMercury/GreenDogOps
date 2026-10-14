"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  applyWeekTemplateSchema,
  copyPreviousWeekSchema,
  createWeekSchema,
  deleteWeekSchema,
  setWeekLocationsSchema,
  updateWeekMetaSchema,
} from "@/features/scheduling/scheduling-grid/schema/week.schema";
import { clearWeekContents } from "@/features/scheduling/scheduling-grid/db/clear-week-contents";
import { cloneWeekContents } from "@/features/scheduling/scheduling-grid/db/clone-week-contents";
import { deleteWeekRow } from "@/features/scheduling/scheduling-grid/db/delete-week-row";
import { findTemplateWeek } from "@/features/scheduling/scheduling-grid/db/find-template-week";
import { findWeekById } from "@/features/scheduling/scheduling-grid/db/find-week-by-id";
import { findWeekByStart } from "@/features/scheduling/scheduling-grid/db/find-week-by-start";
import { getPreviousWeek } from "@/features/scheduling/scheduling-grid/db/get-previous-week";
import { insertDefaultClosures } from "@/features/scheduling/scheduling-grid/db/insert-default-closures";
import { insertWeek } from "@/features/scheduling/scheduling-grid/db/insert-week";
import { replaceWeekLocations } from "@/features/scheduling/scheduling-grid/db/replace-week-locations";
import { snapshotLocationsIntoWeek } from "@/features/scheduling/scheduling-grid/db/snapshot-locations-into-week";
import { snapshotTemplatesIntoWeek } from "@/features/scheduling/scheduling-grid/db/snapshot-templates-into-week";
import { updateWeekTitleNotes } from "@/features/scheduling/scheduling-grid/db/update-week-title-notes";

/**
 * Create a week and snapshot the active shift templates into week lines and
 * the active locations into week locations (the Planning Guide starting point).
 */
export async function createWeek(weekStart: string): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(createWeekSchema, { weekStart });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const me = await actor();

  const existing = await findWeekByStart(supabase, parsed.data.weekStart);
  if (existing) return { ok: true, data: existing.id };

  const week = await insertWeek(supabase, parsed.data.weekStart, me.id);
  if (week.error) return { ok: false, error: week.error.message };
  const weekId = week.id;

  // Snapshot active templates -> week lines.
  await snapshotTemplatesIntoWeek(supabase, weekId);

  // Snapshot active locations -> week locations, then the default closures
  // (Sundays everywhere; Sherman Oaks also Tue/Wed).
  const locs = await snapshotLocationsIntoWeek(supabase, weekId);
  await insertDefaultClosures(supabase, weekId, locs);

  revalidateSchedulePaths();
  return { ok: true, data: weekId };
}

/**
 * Create a week by cloning the most recent prior week: copies its shift lines,
 * locations, closures, and every staffed assignment (same people, days, and
 * times) into the new week. Attendance is reset to "scheduled". If the target
 * week already exists it is rebuilt from the previous week.
 */
export async function copyPreviousWeek(
  weekStart: string,
): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(copyPreviousWeekSchema, { weekStart });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const me = await actor();

  // Most recent existing week strictly before the new start date.
  const prev = await getPreviousWeek(supabase, parsed.data.weekStart);
  if (!prev)
    return { ok: false, error: "There is no previous week to copy from." };

  // Create the target week, or wipe an existing one so the copy is clean.
  const existing = await findWeekByStart(supabase, parsed.data.weekStart);

  let weekId: string;
  if (existing) {
    weekId = existing.id;
    await clearWeekContents(supabase, weekId);
  } else {
    const week = await insertWeek(supabase, parsed.data.weekStart, me.id);
    if (week.error) return { ok: false, error: week.error.message };
    weekId = week.id;
  }

  const cloned = await cloneWeekContents(
    supabase,
    prev.id,
    weekId,
    parsed.data.weekStart,
    me.id,
  );
  if (!cloned.ok) return cloned;

  revalidateSchedulePaths();
  return { ok: true, data: weekId };
}

/**
 * Insert the saved Week Template into an existing week: wipes that week's lines,
 * locations, closures, and assignments, then clones the template into it (work
 * dates recomputed for the target week, attendance reset).
 */
export async function applyWeekTemplate(
  weekId: string,
  templateId: string,
): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(applyWeekTemplateSchema, { weekId, templateId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const me = await actor();

  const template = await findTemplateWeek(supabase, parsed.data.templateId);
  if (!template)
    return { ok: false, error: "That template no longer exists." };

  const targetRow = await findWeekById(supabase, parsed.data.weekId);
  if (!targetRow) return { ok: false, error: "That week no longer exists." };
  if (targetRow.is_template)
    return { ok: false, error: "Cannot apply a template onto a template." };

  // Wipe the target week so the template lands cleanly.
  await clearWeekContents(supabase, targetRow.id);

  const cloned = await cloneWeekContents(
    supabase,
    parsed.data.templateId,
    targetRow.id,
    targetRow.week_start,
    me.id,
  );
  if (!cloned.ok) return cloned;

  revalidateSchedulePaths();
  return { ok: true, data: weekId };
}

/** Replace the ordered set of locations shown on a week's grid. */
export async function setWeekLocations(
  weekId: string,
  locationIds: string[],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(setWeekLocationsSchema, { weekId, locationIds });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await replaceWeekLocations(
    supabase,
    parsed.data.weekId,
    parsed.data.locationIds,
  );
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}

/** Set a week's title and notes. */
export async function updateWeekMeta(
  weekId: string,
  title: string | null,
  notes: string | null,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(updateWeekMetaSchema, { weekId, title, notes });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await updateWeekTitleNotes(
    supabase,
    parsed.data.weekId,
    parsed.data.title,
    parsed.data.notes,
  );
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}

/** Delete a week and everything on its grid. */
export async function deleteWeek(weekId: string): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(deleteWeekSchema, { weekId });
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await deleteWeekRow(supabase, parsed.data.weekId);
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}
