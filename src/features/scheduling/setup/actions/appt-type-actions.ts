"use server";

import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  apptTypeDeptSchema,
  apptTypeReportTrackSchema,
  type ApptTypeDeptValues,
  type ApptTypeReportTrackValues,
} from "@/features/scheduling/setup/schema/appt-type.schema";
import { upsertApptTypeDept } from "@/features/scheduling/setup/db/upsert-appt-type-dept";
import { upsertApptTypeReportTrack } from "@/features/scheduling/setup/db/upsert-appt-type-report-track";

// ===========================================================================
// SETUP — appointment type → department map (Planning Guide Setup)
// ===========================================================================

/**
 * Assign an ezyVet appointment type to a schedule department (or ignore it).
 * Upserts by appt_type so newly-observed types create a row on first save.
 */
export async function saveApptTypeDept(input: ApptTypeDeptValues): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(apptTypeDeptSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const { error } = await upsertApptTypeDept({
    appt_type: v.appt_type,
    department_id: v.is_ignored ? null : v.department_id,
    is_ignored: v.is_ignored,
  });
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}

/**
 * Set which lane an appointment type is counted in on the upcoming-appointments
 * Slack report. Blank clears it (the type stops being counted there).
 */
export async function saveApptTypeReportTrack(
  input: ApptTypeReportTrackValues,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(apptTypeReportTrackSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const { error } = await upsertApptTypeReportTrack(v.appt_type, v.report_track);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  return { ok: true };
}
