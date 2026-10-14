import { PUNCH_LABELS, type PunchType } from "@/lib/timeclock/state";
import type { EffectivePunch } from "@/lib/timeclock/timecard";
import type { CorrectionTarget } from "@/features/scheduling/time-clock/types/correction-target";

type TargetPunch = Pick<EffectivePunch, "id" | "punch_type" | "punched_at" | "origin">;

/**
 * The punches a "wrong time" correction may replace: that day's effective
 * punches of the requested type. Approver-added punches are marked "(added)"
 * and carry the `adjustment:` prefix so the decision targets the right table.
 * `formatTime` renders the instant in the clinics' time zone (server-side).
 */
export function correctionTargets(
  request: { punch_type: PunchType | null; day_punches: readonly TargetPunch[] },
  formatTime: (iso: string) => string,
): CorrectionTarget[] {
  return request.day_punches
    .filter((p) => p.punch_type === request.punch_type)
    .map((p) => ({
      value: `${p.origin === "adjustment" ? "adjustment" : "punch"}:${p.id}`,
      label: `${PUNCH_LABELS[p.punch_type]} at ${formatTime(p.punched_at)}${p.origin === "adjustment" ? " (added)" : ""}`,
    }));
}
