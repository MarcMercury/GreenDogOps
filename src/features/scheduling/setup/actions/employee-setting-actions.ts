"use server";

import { revalidatePath } from "next/cache";
import { ensureCanEdit } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation/form";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
import { revalidateSchedulePaths } from "@/features/scheduling/shared/server/revalidate-schedule";
import {
  employeeSettingSchema,
  scheduleSettingFieldsSchema,
} from "@/features/scheduling/setup/schema/employee-setting.schema";
import { preferredLocationSchema } from "@/features/scheduling/setup/schema/preferred-location.schema";
import {
  upsertEmployeeSetting,
  type EmployeeSettingPatch,
} from "@/features/scheduling/setup/db/upsert-employee-setting";
import { upsertPreferredLocation } from "@/features/scheduling/setup/db/upsert-preferred-location";

// ===========================================================================
// SETUP — employee settings
// ===========================================================================

export async function saveEmployeeSetting(
  personId: string,
  weeklyTarget: number,
  isSchedulable: boolean,
  defaultLocationId: string | null,
  eligibleLocationIds: string[] = [],
  availableDays: number[] = [],
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(employeeSettingSchema, {
    personId,
    weeklyTarget,
    isSchedulable,
    defaultLocationId,
    eligibleLocationIds,
    availableDays,
  });
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const { error } = await upsertEmployeeSetting({
    person_id: v.personId,
    weekly_shift_target: v.weeklyTarget,
    is_schedulable: v.isSchedulable,
    default_location_id: v.defaultLocationId,
    eligible_location_ids: v.eligibleLocationIds,
    available_days: v.availableDays,
  });
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  revalidatePath("/hr");
  return { ok: true };
}

/**
 * Partial update of a person's scheduling settings, used by the HR profile
 * (Eligibility tab → Scheduling settings panel) so edits made there write back
 * to the SAME `sched_employee_setting` row that Schedule → Setup → Employees
 * reads and writes. Only the provided fields are changed; the rest of the row
 * (default/eligible locations, notes) is preserved.
 */
export async function saveScheduleSettingFields(
  personId: string,
  fields: {
    isSchedulable?: boolean;
    weeklyTarget?: number;
    availableDays?: number[];
  },
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(scheduleSettingFieldsSchema, { personId, fields });
  if (!parsed.ok) return parsed;
  const v = parsed.data;

  const patch: EmployeeSettingPatch = { person_id: v.personId };
  if (v.fields.isSchedulable !== undefined) patch.is_schedulable = v.fields.isSchedulable;
  if (v.fields.weeklyTarget !== undefined) patch.weekly_shift_target = v.fields.weeklyTarget;
  if (v.fields.availableDays !== undefined) patch.available_days = v.fields.availableDays;

  const { error } = await upsertEmployeeSetting(patch);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  revalidatePath("/hr");
  return { ok: true };
}

/**
 * Mirror of the HR roster's "Preferred location" field. Writes to
 * person_employment (the single source of truth) so the value stays in sync
 * between the HR profile and Schedule → Setup → Employees.
 */
export async function savePreferredLocation(
  personId: string,
  locationId: string | null,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const parsed = parseInput(preferredLocationSchema, { personId, locationId });
  if (!parsed.ok) return parsed;

  const { error } = await upsertPreferredLocation(parsed.data.personId, parsed.data.locationId);
  if (error) return { ok: false, error };
  revalidateSchedulePaths();
  revalidatePath("/hr");
  return { ok: true };
}
