"use server";

import { recordAudit } from "@/lib/auth/session";
import { runInBackground } from "@/lib/notify/emit";
import { notifyPunchReviewed } from "@/lib/notify/events/timeclock";
import { parseInput } from "@/lib/validation/form";
import { getPunchPerson } from "@/features/scheduling/time-clock/db/get-punch-person";
import { reviewTimePunch } from "@/features/scheduling/time-clock/db/review-time-punch";
import { ERRORS } from "@/features/scheduling/time-clock/lib/errors";
import { offsiteReviewSchema } from "@/features/scheduling/time-clock/schema/offsite-review.schema";
import { approverGate, notOwnTime, reviewerName } from "@/features/scheduling/time-clock/server/approver-gate";
import { revalidateTimeClockPaths } from "@/features/scheduling/time-clock/server/revalidate-time-clock";
import type { ApproverResult } from "@/features/scheduling/time-clock/types/approver-result";
import type { TimeClockRpcResult } from "@/features/scheduling/time-clock/types/rpc-result";

// Approver action — see server/approver-gate.ts for the role and
// no-own-time rules every Time Clock action applies.

export async function reviewOffsitePunch(
  punchId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  const parsed = parseInput(offsiteReviewSchema, { punchId, decision, note });
  if (!parsed.ok) return { ok: false, error: "Unknown punch or decision." };
  const input = parsed.data;

  const punch = await getPunchPerson(input.punchId);
  if (!punch) return { ok: false, error: ERRORS.not_found };
  const own = notOwnTime(gate.current, punch.person_id);
  if (own) return own;

  const { data, error } = await reviewTimePunch({
    punchId: input.punchId,
    decision: input.decision,
    note: input.note,
    reviewerId: gate.current.appUser.id,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const res = data as TimeClockRpcResult;
  if (!res.ok) return { ok: false, error: ERRORS[res.error ?? ""] ?? "Not saved." };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: input.decision === "approved" ? "timeclock.offsite_approved" : "timeclock.offsite_rejected",
    entity: "time_punch",
    entityId: input.punchId,
    summary: input.decision === "approved" ? "Approved an off-site punch" : "Rejected an off-site punch (voided)",
    metadata: { person_id: punch.person_id, note: input.note || null },
  });
  runInBackground(() =>
    notifyPunchReviewed({
      punchId: input.punchId,
      decision: input.decision,
      note: input.note?.trim() || null,
      reviewerName: reviewerName(gate.current),
      actorUserId: gate.current.appUser.id,
    }),
  );
  revalidateTimeClockPaths();
  return { ok: true, message: input.decision === "approved" ? "Approved." : "Rejected — the punch no longer counts." };
}
