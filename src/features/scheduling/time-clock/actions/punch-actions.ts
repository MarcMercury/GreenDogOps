"use server";

import { recordAudit } from "@/lib/auth/session";
import { runInBackground } from "@/lib/notify/emit";
import { notifyPunchAdded } from "@/lib/notify/events/timeclock";
import { localToInstant } from "@/lib/timeclock/local-time";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import { isPunchType, PUNCH_LABELS } from "@/lib/timeclock/state";
import { parseInput } from "@/lib/validation/form";
import { addDays, isIsoDate, todayInWorkTz } from "@/lib/worklist/dates";
import { insertPunchAdjustment } from "@/features/scheduling/time-clock/db/insert-punch-adjustment";
import { personExists } from "@/features/scheduling/time-clock/db/person-exists";
import { ADD_PUNCH_WINDOW_DAYS } from "@/features/scheduling/time-clock/lib/constants";
import {
  addPunchSchema,
  type AddPunchFormValues,
} from "@/features/scheduling/time-clock/schema/add-punch.schema";
import { approverGate, notOwnTime } from "@/features/scheduling/time-clock/server/approver-gate";
import { revalidateTimeClockPaths } from "@/features/scheduling/time-clock/server/revalidate-time-clock";
import type { ApproverResult } from "@/features/scheduling/time-clock/types/approver-result";

// Approver action — see server/approver-gate.ts for the role and
// no-own-time rules every Time Clock action applies.

export async function addMissingPunch(input: AddPunchFormValues): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  const parsed = parseInput(addPunchSchema, input);
  if (!parsed.ok) return { ok: false, error: "Unknown employee." };
  const { person_id: personId, work_date: workDate, punch_type: punchType, time, next_day: nextDay } = parsed.data;
  const reason = parsed.data.reason.trim().slice(0, 1000);

  const own = notOwnTime(gate.current, personId);
  if (own) return own;
  const today = todayInWorkTz();
  if (!isIsoDate(workDate) || workDate > today || workDate < addDays(today, -ADD_PUNCH_WINDOW_DAYS)) {
    return { ok: false, error: `Pick a date within the last ${ADD_PUNCH_WINDOW_DAYS} days.` };
  }
  if (!isPunchType(punchType)) return { ok: false, error: "Pick which punch." };
  if (!reason) return { ok: false, error: "Please give a reason." };
  const instant = localToInstant(nextDay ? addDays(workDate, 1) : workDate, time, TIME_CLOCK_TZ);
  if (!instant) return { ok: false, error: "Enter a valid time." };
  if (instant.getTime() > Date.now()) return { ok: false, error: "That time is in the future." };

  if (!(await personExists(personId))) return { ok: false, error: "Unknown employee." };

  const { data: row, error } = await insertPunchAdjustment({
    personId,
    punchType,
    punchedAt: instant.toISOString(),
    workDate,
    reason,
    createdBy: gate.current.appUser.id,
  });
  if (error || !row) return { ok: false, error: `Could not save: ${error?.message ?? "no row returned"}` };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "timeclock.punch_added",
    entity: "time_punch_adjustment",
    entityId: row.id,
    summary: `Added a missing ${PUNCH_LABELS[punchType].toLowerCase()} punch`,
    metadata: { person_id: personId, work_date: workDate, punched_at: instant.toISOString(), reason },
  });
  const adjustmentId = row.id;
  runInBackground(() => notifyPunchAdded(adjustmentId, gate.current.appUser.id));
  revalidateTimeClockPaths();
  return { ok: true, message: `${PUNCH_LABELS[punchType]} added.` };
}
