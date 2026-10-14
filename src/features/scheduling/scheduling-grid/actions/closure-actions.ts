"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { toggleClosureSchema } from "@/features/scheduling/scheduling-grid/schema/closure.schema";
import { deleteClosure } from "@/features/scheduling/scheduling-grid/db/delete-closure";
import { findClosure } from "@/features/scheduling/scheduling-grid/db/find-closure";
import { insertClosure } from "@/features/scheduling/scheduling-grid/db/insert-closure";

/** Close a location on one day of a week, or re-open it if already closed. */
export async function toggleClosure(
  weekId: string,
  locationId: string,
  dayOfWeek: number,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(toggleClosureSchema, { weekId, locationId, dayOfWeek });
  if (!parsed.ok) return parsed;
  const cell = parsed.data;

  const supabase = await createClient();
  const existing = await findClosure(
    supabase,
    cell.weekId,
    cell.locationId,
    cell.dayOfWeek,
  );

  if (existing) {
    const { error } = await deleteClosure(supabase, existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await insertClosure(supabase, {
      week_id: cell.weekId,
      location_id: cell.locationId,
      day_of_week: cell.dayOfWeek,
    });
    if (error) return { ok: false, error: error.message };
  }
  revalidateSchedulePaths();
  return { ok: true };
}
