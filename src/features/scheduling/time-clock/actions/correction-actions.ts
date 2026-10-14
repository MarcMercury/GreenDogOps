"use server";

import { recordAudit } from "@/lib/auth/session";
import { runInBackground } from "@/lib/notify/emit";
import { notifyCorrectionDecided } from "@/lib/notify/events/timeclock";
import { parseInput } from "@/lib/validation/form";
import { decideTimeCorrection } from "@/features/scheduling/time-clock/db/decide-time-correction";
import { getCorrectionRequest } from "@/features/scheduling/time-clock/db/get-correction-request";
import { ERRORS } from "@/features/scheduling/time-clock/lib/errors";
import { parseReplaceTarget } from "@/features/scheduling/time-clock/lib/replace-target";
import { correctionDecisionSchema } from "@/features/scheduling/time-clock/schema/correction-decision.schema";
import { approverGate, notOwnTime, reviewerName } from "@/features/scheduling/time-clock/server/approver-gate";
import { revalidateTimeClockPaths } from "@/features/scheduling/time-clock/server/revalidate-time-clock";
import type { ApproverResult } from "@/features/scheduling/time-clock/types/approver-result";
import type { TimeClockRpcResult } from "@/features/scheduling/time-clock/types/rpc-result";

// Approver action — see server/approver-gate.ts for the role and
// no-own-time rules every Time Clock action applies.

export async function decideCorrection(
  requestId: string,
  decision: "approved" | "denied",
  note: string,
  replaceTarget: string | null,
): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  const parsed = parseInput(correctionDecisionSchema, { requestId, decision, note, replaceTarget });
  if (!parsed.ok) return { ok: false, error: "Unknown request or decision." };
  const input = parsed.data;
  const replace = parseReplaceTarget(input.replaceTarget);
  if (!replace.ok) return replace;
  const { replacePunchId, replaceAdjustmentId } = replace.target;

  const req = await getCorrectionRequest(input.requestId);
  if (!req) return { ok: false, error: ERRORS.not_found };
  const own = notOwnTime(gate.current, req.person_id);
  if (own) return own;

  const { data, error } = await decideTimeCorrection({
    requestId: input.requestId,
    decision: input.decision,
    note: input.note,
    reviewerId: gate.current.appUser.id,
    replacePunchId,
    replaceAdjustmentId,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const res = data as TimeClockRpcResult;
  if (!res.ok) return { ok: false, error: ERRORS[res.error ?? ""] ?? "Not saved." };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: input.decision === "approved" ? "timeclock.correction_approved" : "timeclock.correction_denied",
    entity: "time_correction_request",
    entityId: input.requestId,
    summary: `${input.decision === "approved" ? "Approved" : "Denied"} a time correction (${req.kind})`,
    metadata: {
      person_id: req.person_id,
      note: input.note || null,
      replace_punch_id: replacePunchId,
      replace_adjustment_id: replaceAdjustmentId,
    },
  });
  runInBackground(() =>
    notifyCorrectionDecided({
      requestId: input.requestId,
      decision: input.decision,
      note: input.note?.trim() || null,
      reviewerName: reviewerName(gate.current),
      actorUserId: gate.current.appUser.id,
    }),
  );
  revalidateTimeClockPaths();
  return { ok: true, message: input.decision === "approved" ? "Approved — the timecard is updated." : "Denied." };
}
