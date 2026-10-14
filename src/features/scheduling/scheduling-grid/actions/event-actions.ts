"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import { setEventSchema } from "@/features/scheduling/scheduling-grid/schema/event.schema";
import { deleteEvent } from "@/features/scheduling/scheduling-grid/db/delete-event";
import { findEvent } from "@/features/scheduling/scheduling-grid/db/find-event";
import { insertEvent } from "@/features/scheduling/scheduling-grid/db/insert-event";
import { updateEventTitle } from "@/features/scheduling/scheduling-grid/db/update-event-title";

/** Set (or clear, when title is blank) the event note for a location/day cell. */
export async function setEvent(
  weekId: string,
  locationId: string,
  dayOfWeek: number,
  title: string,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  const parsed = parseInput(setEventSchema, { weekId, locationId, dayOfWeek, title });
  if (!parsed.ok) return parsed;
  const cell = parsed.data;

  const supabase = await createClient();
  const clean = cell.title.trim();

  const existing = await findEvent(
    supabase,
    cell.weekId,
    cell.locationId,
    cell.dayOfWeek,
  );

  if (!clean) {
    if (existing) {
      const { error } = await deleteEvent(supabase, existing.id);
      if (error) return { ok: false, error: error.message };
    }
    revalidateSchedulePaths();
    return { ok: true };
  }

  const { error } = existing
    ? await updateEventTitle(supabase, existing.id, clean)
    : await insertEvent(supabase, {
        week_id: cell.weekId,
        location_id: cell.locationId,
        day_of_week: cell.dayOfWeek,
        title: clean,
      });
  if (error) return { ok: false, error: error.message };
  revalidateSchedulePaths();
  return { ok: true };
}
