"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { actor } from "@/features/scheduling/shared/server/actor";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { cloneWeekContents } from "@/features/scheduling/scheduling-grid/db/clone-week-contents";
import {
  createTemplateSchema,
  deleteTemplateSchema,
  duplicateTemplateSchema,
  renameTemplateSchema,
  syncTemplateWeekSchema,
} from "@/features/scheduling/setup/schema/week-template.schema";
import { TEMPLATE_WEEK_START } from "@/features/scheduling/setup/lib/template-week-start";
import { isDuplicate } from "@/features/scheduling/setup/lib/is-duplicate";
import { planTemplateWeekSync } from "@/features/scheduling/setup/lib/template-sync-plan";
import { insertTemplateWeek } from "@/features/scheduling/setup/db/insert-template-week";
import { snapshotShiftTemplatesIntoTemplateWeek } from "@/features/scheduling/setup/db/snapshot-shift-templates-into-template-week";
import { snapshotLocationsIntoTemplateWeek } from "@/features/scheduling/setup/db/snapshot-locations-into-template-week";
import { findTemplateWeek } from "@/features/scheduling/setup/db/find-template-week";
import { renameTemplateWeek } from "@/features/scheduling/setup/db/rename-template-week";
import { deleteTemplateWeek } from "@/features/scheduling/setup/db/delete-template-week";
import { getTemplateWeekLines } from "@/features/scheduling/setup/db/get-template-week-lines";
import { getActiveShiftTemplates } from "@/features/scheduling/setup/db/get-active-shift-templates";
import { getActiveDepartmentIds } from "@/features/scheduling/setup/db/get-active-department-ids";
import { deleteTemplateWeekLines } from "@/features/scheduling/setup/db/delete-template-week-lines";
import { insertTemplateWeekLines } from "@/features/scheduling/setup/db/insert-template-week-lines";
import { updateTemplateWeekLine } from "@/features/scheduling/setup/db/update-template-week-line";

// ===========================================================================
// SETUP — Week Templates (full, populated grids the admin applies to weeks)
// ===========================================================================

/**
 * Create a named week template: a normal sched_week flagged is_template, which
 * the admin populates with shift lines and staffed assignments on the grid and
 * then applies to any week.
 *
 * Templates all sit on the same sentinel week_start; 0214 made the week_start
 * uniqueness constraint apply only to real weeks so they can.
 */
export async function createTemplate(
  name: string,
): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(createTemplateSchema, { name });
  if (!parsed.ok) return parsed;

  const me = await actor();
  const created = await insertTemplateWeek(parsed.data.name, me.id);
  if ("error" in created) {
    return {
      ok: false,
      error: isDuplicate(created.error)
        ? `A template called “${parsed.data.name}” already exists.`
        : created.error,
    };
  }
  const weekId = created.id;

  // Snapshot active dept/shift templates -> week lines.
  await snapshotShiftTemplatesIntoTemplateWeek(weekId);
  // Snapshot active locations -> week locations, plus the default closures.
  await snapshotLocationsIntoTemplateWeek(weekId);

  revalidateSchedulePaths();
  return { ok: true, data: weekId };
}

/** Rename a template. Names are unique case-insensitively. */
export async function renameTemplate(
  templateId: string,
  name: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(renameTemplateSchema, { templateId, name });
  if (!parsed.ok) return parsed;

  const { error } = await renameTemplateWeek(parsed.data.templateId, parsed.data.name);
  if (error) {
    return {
      ok: false,
      error: isDuplicate(error)
        ? `A template called “${parsed.data.name}” already exists.`
        : error,
    };
  }
  revalidateSchedulePaths();
  return { ok: true };
}

/** Copy a template, including its shift lines and staffing, under a new name. */
export async function duplicateTemplate(
  templateId: string,
  name: string,
): Promise<ActionResult<string>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(duplicateTemplateSchema, { templateId, name });
  if (!parsed.ok) return parsed;

  const me = await actor();

  const source = await findTemplateWeek(parsed.data.templateId);
  if (!source) return { ok: false, error: "That template no longer exists." };

  const created = await insertTemplateWeek(parsed.data.name, me.id);
  if ("error" in created) {
    return {
      ok: false,
      error: isDuplicate(created.error)
        ? `A template called “${parsed.data.name}” already exists.`
        : created.error,
    };
  }

  const newId = created.id;
  const supabase = await createClient();
  const cloned = await cloneWeekContents(
    supabase,
    parsed.data.templateId,
    newId,
    TEMPLATE_WEEK_START,
    me.id,
  );
  if (!cloned.ok) return cloned;

  revalidateSchedulePaths();
  return { ok: true, data: newId };
}

/** Delete a template and everything on its grid. */
export async function deleteTemplate(
  templateId: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(deleteTemplateSchema, { templateId });
  if (!parsed.ok) return parsed;

  const { error } = await deleteTemplateWeek(parsed.data.templateId);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}

/**
 * Make a template's shift lines mirror the Dept/Shift Template exactly:
 * inserts lines for new template rows, re-syncs drifted ones (department, role,
 * label, times, order), and drops every line that no longer has a live template
 * behind it — inactive templates, inactive departments, duplicates, and ad-hoc
 * lines added straight onto the template grid. Assignments on dropped lines go
 * with them.
 */
export async function syncTemplateWeekFromShiftTemplates(
  templateId: string,
): Promise<ActionResult<{ added: number; updated: number; removed: number }>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(syncTemplateWeekSchema, { templateId });
  if (!parsed.ok) return parsed;

  const weekRow = await findTemplateWeek(parsed.data.templateId);
  const weekId = weekRow?.id;
  if (!weekId)
    return { ok: false, error: "No Week Template has been saved yet." };

  const [lineRes, tplRes, activeDepts] = await Promise.all([
    getTemplateWeekLines(weekId),
    getActiveShiftTemplates(),
    getActiveDepartmentIds(),
  ]);
  if (lineRes.error) return { ok: false, error: lineRes.error };
  if (tplRes.error) return { ok: false, error: tplRes.error };

  const { toInsert, toUpdate, toRemove } = planTemplateWeekSync(
    weekId,
    lineRes.lines,
    tplRes.templates,
    activeDepts,
  );

  if (toRemove.length > 0) {
    const { error } = await deleteTemplateWeekLines(toRemove);
    if (error) return { ok: false, error };
  }
  if (toInsert.length > 0) {
    const { error } = await insertTemplateWeekLines(toInsert);
    if (error) return { ok: false, error };
  }
  for (const u of toUpdate) {
    const { error } = await updateTemplateWeekLine(u.id, u.patch);
    if (error) return { ok: false, error };
  }

  revalidateSchedulePaths();
  return {
    ok: true,
    data: {
      added: toInsert.length,
      updated: toUpdate.length,
      removed: toRemove.length,
    },
  };
}
